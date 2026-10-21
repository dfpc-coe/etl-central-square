import type { Static, TSchema } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import type { Event, NamedSchema } from '@tak-ps/etl';
import type { Feature } from '@tak-ps/node-cot'
import ETL, { SchemaType, handler as internal, local, DataFlowType, InvocationType } from '@tak-ps/etl';
import CentralSquare, { CADEvent, CADUnit } from './lib/central-square.js';
import type { Unknowns } from './lib/central-square.js';
import { EventCache, EventSync } from './lib/events.js';
import Geocoder from './lib/geocode.js';
import {
    addressLine,
    allowedAgency,
    callOf,
    cfsNumber,
    coordinates,
    parseAgencies,
    parseBBox,
    parseFallback,
    unitFeature,
    unitIdentifier
} from './lib/cad.js';
import type { Coordinate } from './lib/cad.js';

const DATA_TYPE_CFS = 'Calls for Service';
const DATA_TYPE_UNITS = 'Units';

const SCHEMA_CAD_EVENT = 'CADEvent';
const SCHEMA_CAD_UNIT = 'CADUnit';

/** External ID system CFS numbers are filed under on CloudTAK Events */
const EXTERNAL_SYSTEM = 'central-square';

/** Marks the Assignments this task manages so people added by users are left alone */
const ASSIGNMENT_REMARKS = 'CentralSquare CAD Unit';

const InputSchema = Type.Object({
    BaseURL: Type.String({
        description: 'Base URL of the Pro Suite deployment - ie https://agency.centralsquarecloudgov.com'
    }),
    Username: Type.String({
        description: 'Pro Suite API user provisioned by the agency administrator'
    }),
    Password: Type.String({
        description: 'Password for the Pro Suite API user'
    }),
    Domain: Type.Optional(Type.String({
        description: 'Active Directory domain - only required for agencies using LDAP authentication'
    })),
    DataType: Type.String({
        default: DATA_TYPE_CFS,
        enum: [DATA_TYPE_CFS, DATA_TYPE_UNITS],
        description: 'Calls for Service writes CFS incidents to CloudTAK Events with their Units as Assignments, Units posts AVL unit locations'
    }),
    Agencies: Type.Array(Type.String(), {
        default: [],
        description: 'Agency codes to submit - ie BVFD, KCCAMB. A record is kept when its Dispatch Agency or Primary Response Agency matches any code. Leave empty to submit every agency the API user can access'
    }),
    BoundingBox: Type.Optional(Type.String({
        description: 'Bounding Box of acceptable geocoded locations as minLon,minLat,maxLon,maxLat - ie -105.4,39.5,-104.6,40.0. Geocoded results outside of this box are discarded'
    })),
    FallbackCoordinates: Type.Optional(Type.String({
        description: 'Latitude,Longitude used for records without coordinates (and that could not be geocoded) - ie 39.7392,-104.9903'
    })),
    ExpireHours: Type.Number({
        default: 1,
        minimum: 0.25,
        description: 'Hours after the last poll at which a call for service Event ends on its own if this layer stops reporting - every poll of an active call pushes the expiry out again'
    }),
    DEBUG: Type.Boolean({
        default: false,
        description: 'Print results in logs'
    })
});

/** The cached Pro Suite token and the Event cache share the ephemeral store */
const Ephemeral = Type.Object({
    access_token: Type.Optional(Type.String()),
    access_token_expires: Type.Optional(Type.String()),
    events: Type.Optional(Type.Unknown())
});

export default class Task extends ETL {
    static name = 'etl-central-square'
    static flow = [ DataFlowType.Incoming ];
    static invocation = [ InvocationType.Schedule ];
    static invocationDefaults = {
        schedule: { enabled: true, cron: 'rate(1 minute)' }
    };

    async schema(
        type: SchemaType = SchemaType.Input,
        flow: DataFlowType = DataFlowType.Incoming
    ): Promise<TSchema | Array<NamedSchema>> {
        if (flow === DataFlowType.Incoming) {
            if (type === SchemaType.Input) {
                return InputSchema;
            } else {
                return [
                    { id: SCHEMA_CAD_EVENT, schema: CADEvent },
                    { id: SCHEMA_CAD_UNIT, schema: CADUnit }
                ];
            }
        } else {
            return Type.Object({});
        }
    }

    async control(): Promise<void> {
        const env = await this.env(InputSchema);
        const ephemeral = await this.ephemeral(Ephemeral);

        const api = new CentralSquare({
            url: env.BaseURL,
            username: env.Username,
            password: env.Password,
            domain: env.Domain,
            debug: env.DEBUG,
            token: {
                access_token: ephemeral.access_token,
                expires: Number(ephemeral.access_token_expires)
            },
            onToken: async (token) => {
                await this.patchEphemeral({
                    access_token: token.access_token,
                    access_token_expires: String(token.expires)
                });
            }
        });

        if (env.DataType === DATA_TYPE_UNITS) {
            await this.controlUnits(api, env);
        } else {
            await this.controlCalls(api, env, this.eventCache(ephemeral.events));
        }
    }

    /**
     * AVL unit locations are posted to the map as CoT
     */
    async controlUnits(api: CentralSquare, env: Static<typeof InputSchema>): Promise<void> {
        const fc: Static<typeof Feature.InputFeatureCollection> = {
            type: 'FeatureCollection',
            features: []
        };

        const allowed = parseAgencies(env.Agencies);
        const fallback = parseFallback(env.FallbackCoordinates);
        let filtered = 0;

        for (const record of await api.units()) {
            if (!allowedAgency(allowed, record)) {
                filtered++;
                continue;
            }

            const identifier = unitIdentifier(record);
            const geometry = coordinates(record) ?? fallback;
            if (!identifier || !geometry) continue;

            try {
                fc.features.push(unitFeature(identifier, record, geometry));
            } catch (err) {
                console.error(`not ok - skipping Unit ${identifier}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        if (allowed.size) {
            console.log(`ok - ${filtered} records discarded by Agencies filter (${[...allowed].join(', ')})`);
        }

        console.log(`ok - obtained ${fc.features.length} features`);

        await this.submit(fc);
    }

    /**
     * Active Calls for Service are written to CloudTAK Events - one per CFS
     * number - with the units dispatched to each call as Assignments. Calls that
     * are no longer active are ended
     */
    async controlCalls(api: CentralSquare, env: Static<typeof InputSchema>, cache: EventCache): Promise<void> {
        const sync = new EventSync(this.api, cache, {
            system: EXTERNAL_SYSTEM,
            marker: ASSIGNMENT_REMARKS,
            expireHours: env.ExpireHours
        });

        const geocoder = new Geocoder({
            api: this.etl.api,
            fetch: (url) => this.fetch(url),
            bbox: parseBBox(env.BoundingBox),
            debug: env.DEBUG
        });

        const allowed = parseAgencies(env.Agencies);
        const fallback = parseFallback(env.FallbackCoordinates);
        let filtered = 0;

        for (const record of await api.calls()) {
            if (!allowedAgency(allowed, record)) {
                filtered++;
                continue;
            }

            const number = cfsNumber(record);
            if (!number) continue;

            const geometry = await this.locate(env, geocoder, number, record, fallback);
            if (!geometry) continue;

            try {
                await sync.sync(callOf(number, record, geometry));
            } catch (err) {
                console.error(`not ok - skipping CFS ${number}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        await sync.end();

        await this.patchEphemeral({ events: sync.cache });

        if (allowed.size) {
            console.log(`ok - ${filtered} records discarded by Agencies filter (${[...allowed].join(', ')})`);
        }

        console.log(`ok - ${sync.summary()}`);
    }

    /**
     * Coordinates on the record, then a geocode of its address, then the
     * configured fallback
     */
    async locate(
        env: Static<typeof InputSchema>,
        geocoder: Geocoder,
        number: string,
        record: Unknowns,
        fallback: Coordinate | null
    ): Promise<Coordinate | null> {
        let geometry = coordinates(record);
        if (geometry) return geometry;

        const address = addressLine(record);

        if (address) {
            if (env.DEBUG) console.error(`DEBUG - CFS ${number} has no coordinates - geocoding "${address}"`);
            geometry = await geocoder.locate(address);
            if (geometry) return geometry;
        }

        if (env.DEBUG) console.error(`DEBUG - CFS ${number} has no coordinates${fallback ? ' - using fallback' : ''}`);

        return fallback;
    }

    eventCache(events: unknown): EventCache {
        try {
            return this.type(EventCache, events ?? {});
        } catch {
            return {};
        }
    }

    /**
     * The ephemeral store is replaced on every write - merge so the cached
     * token and the Event cache never clobber each other
     */
    async patchEphemeral(values: Record<string, unknown>): Promise<void> {
        const layer = await this.fetchLayer();
        const ephemeral = { ...(layer.incoming?.ephemeral ?? {}), ...values };

        await this.setEphemeral(ephemeral);

        if (layer.incoming) layer.incoming.ephemeral = ephemeral;
    }
}

await local(await Task.init(import.meta.url), import.meta.url);
export async function handler(event: Event = {}) {
    return await internal(await Task.init(import.meta.url), event);
}
