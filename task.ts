import { createHash } from 'node:crypto';
import type { Static, TSchema } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import type { Event, NamedSchema, CoreEvent, CoreEventUpdate, CoreEventAssignment } from '@tak-ps/etl';
import { Feature } from '@tak-ps/node-cot'
import ETL, { SchemaType, handler as internal, local, DataFlowType, InvocationType } from '@tak-ps/etl';

import { fetch } from '@tak-ps/etl';

const Nullable = <T extends TSchema>(type: T) => Type.Union([Type.Null(), type]);

const DATA_TYPE_CFS = 'Calls for Service';
const DATA_TYPE_UNITS = 'Units';

const SCHEMA_CAD_EVENT = 'CADEvent';
const SCHEMA_CAD_UNIT = 'CADUnit';

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
        description: 'Dispatch Agency codes to submit - ie BVFD, KCCAMB. Records from other agencies are discarded. Leave empty to submit every agency the API user can access'
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

const CADDropdown = Type.Object({
    UniqueIdentifier: Type.Optional(Nullable(Type.Union([Type.String(), Type.Number()]))),
    Description: Type.Optional(Nullable(Type.String())),
    FullDescription: Type.Optional(Nullable(Type.String())),
    Code: Type.Optional(Nullable(Type.String())),
    Abbreviation: Type.Optional(Nullable(Type.String())),
    Level: Type.Optional(Nullable(Type.Union([Type.String(), Type.Number()]))),
    ORI: Type.Optional(Nullable(Type.String()))
});

const CADAddress = Type.Object({
    FreeFormAddress: Type.Optional(Nullable(Type.String())),
    Street: Type.Optional(Nullable(Type.String())),
    City: Type.Optional(Nullable(Type.String())),
    Community: Type.Optional(Nullable(Type.String())),
    State: Type.Optional(Nullable(Type.Union([Type.String(), CADDropdown]))),
    Zip: Type.Optional(Nullable(Type.String())),
    Latitude: Type.Optional(Nullable(Type.Number())),
    Longitude: Type.Optional(Nullable(Type.Number())),
    Lat: Type.Optional(Nullable(Type.Number())),
    Lon: Type.Optional(Nullable(Type.Number()))
});

const CADIncidentCode = Type.Object({
    IncidentCode: Type.Optional(Nullable(CADDropdown)),
    IsPrimary: Type.Optional(Nullable(Type.Boolean())),
    UniqueIdentifier: Type.Optional(Nullable(Type.Union([Type.String(), Type.Number()]))),
    Description: Type.Optional(Nullable(Type.String())),
    Code: Type.Optional(Nullable(Type.String()))
});

const CADUnitAssignment = Type.Object({
    UnitID: Type.Optional(Nullable(Type.Union([Type.String(), Type.Number()]))),
    Unit: Type.Optional(Nullable(CADDropdown)),
    UnitStatus: Type.Optional(Nullable(CADDropdown))
});

/**
 * Pro Suite is configured per agency and the CFS record exposes a superset of
 * these fields - everything is optional so a single missing or agency specific
 * value never discards an otherwise usable call
 */
const CADEvent = Type.Object({
    CFSNumber: Type.Optional(Nullable(Type.String())),
    ExternalCFSNumber: Type.Optional(Nullable(Type.String())),
    CallDateTime: Type.Optional(Nullable(Type.String())),
    IncidentDateTime: Type.Optional(Nullable(Type.String())),
    ClosedDateTime: Type.Optional(Nullable(Type.String())),
    CurrentlyActive: Type.Optional(Nullable(Type.Boolean())),
    UseCaution: Type.Optional(Nullable(Type.Boolean())),
    DispatchAgency: Type.Optional(Nullable(CADDropdown)),
    CFSStatus: Type.Optional(Nullable(CADDropdown)),
    Priority: Type.Optional(Nullable(CADDropdown)),
    Zone: Type.Optional(Nullable(CADDropdown)),
    Beat: Type.Optional(Nullable(CADDropdown)),
    IncidentCode: Type.Optional(Nullable(Type.Union([Type.Array(CADIncidentCode), CADIncidentCode]))),
    Disposition: Type.Optional(Nullable(Type.Union([Type.Array(CADDropdown), CADDropdown]))),
    CallTaker: Type.Optional(Nullable(CADDropdown)),
    PrimaryOfficer: Type.Optional(Nullable(CADDropdown)),
    GeneralAddress: Type.Optional(Nullable(CADAddress)),
    Address: Type.Optional(Nullable(CADAddress)),
    Location: Type.Optional(Nullable(CADAddress)),
    NearestCrossStreet: Type.Optional(Nullable(Type.String())),
    NearestIntersection: Type.Optional(Nullable(Type.String())),
    Reporter: Type.Optional(Nullable(Type.Object({
        FreeformFullName: Type.Optional(Nullable(Type.String())),
        FromPhoneNumber: Type.Optional(Nullable(Type.String())),
        ContactPhoneNumber: Type.Optional(Nullable(Type.String())),
        HowReported: Type.Optional(Nullable(CADDropdown))
    }))),
    Units: Type.Optional(Nullable(Type.Array(CADUnitAssignment)))
});

/**
 * The /units/search response is agency configurable and is documented only as
 * "unit status, configuration and GPS location data" - the same permissive
 * approach used for CFS records applies
 */
const CADUnit = Type.Object({
    UniqueIdentifier: Type.Optional(Nullable(Type.Union([Type.String(), Type.Number()]))),
    UnitID: Type.Optional(Nullable(Type.Union([Type.String(), Type.Number()]))),
    UnitName: Type.Optional(Nullable(Type.String())),
    Unit: Type.Optional(Nullable(CADDropdown)),
    UnitStatus: Type.Optional(Nullable(CADDropdown)),
    Status: Type.Optional(Nullable(CADDropdown)),
    DispatchAgency: Type.Optional(Nullable(CADDropdown)),
    Agency: Type.Optional(Nullable(CADDropdown)),
    Zone: Type.Optional(Nullable(CADDropdown)),
    Beat: Type.Optional(Nullable(CADDropdown)),
    CFSNumber: Type.Optional(Nullable(Type.String())),
    Personnel: Type.Optional(Nullable(Type.Union([Type.Array(CADDropdown), CADDropdown]))),
    Latitude: Type.Optional(Nullable(Type.Number())),
    Longitude: Type.Optional(Nullable(Type.Number())),
    Heading: Type.Optional(Nullable(Type.Union([Type.String(), Type.Number()]))),
    Speed: Type.Optional(Nullable(Type.Union([Type.String(), Type.Number()]))),
    LocationDateTime: Type.Optional(Nullable(Type.String())),
    Location: Type.Optional(Nullable(CADAddress)),
    Address: Type.Optional(Nullable(CADAddress))
});

const SuggestResponse = Type.Object({
    items: Type.Array(Type.Object({
        text: Type.String(),
        magicKey: Type.String()
    }))
});

const ForwardResponse = Type.Object({
    items: Type.Array(Type.Object({
        address: Type.String(),
        location: Type.Object({
            x: Type.Number(),
            y: Type.Number()
        }),
        score: Type.Number()
    }))
});

const TokenResponse = Type.Object({
    access_token: Type.String(),
    token_type: Type.Optional(Type.String()),
    expires_in: Type.Optional(Type.Integer())
});

/** CloudTAK Event ID, a digest of the last state written & the expiry last set, keyed by CFS number */
const EventCache = Type.Record(Type.String(), Type.Object({
    id: Type.String(),
    hash: Type.String(),
    expires: Type.Optional(Type.String())
}));

// Pro Suite tokens default to a 24 hour lifetime and the token endpoint is
// aggressively rate limited - refresh early rather than on every call
const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 60 * 60 * 1000;

const PAGE_LIMIT = 100;
const MAX_PAGES = 20;
const STALE_MINUTES = 20;

// Required on every request and recorded in the Pro Suite audit trail
const FROM_HEADER = 'CloudTAK-ETL';

/** External ID system CFS numbers are filed under on CloudTAK Events */
const EXTERNAL_SYSTEM = 'central-square';

/** MIL-STD-2525E Incident symbol - the CloudTAK default for a new Event */
const EVENT_SIDC = '10034000001100000000';

/** Marks the Assignments this task manages so people added by users are left alone */
const ASSIGNMENT_REMARKS = 'CentralSquare CAD Unit';

const NAME_MAX_LENGTH = 64;

type Unknowns = Record<string, unknown>;

type Priority = NonNullable<CoreEventUpdate['priority']>;

type Assignee = {
    name: string;
    role: string;
};

/** A Call for Service ready to be written to CloudTAK */
type Call = {
    number: string;
    event: Required<Pick<CoreEventUpdate, 'name' | 'priority' | 'geometry' | 'location' | 'remarks' | 'metadata'>> & Pick<CoreEventUpdate, 'started'>;
    units: Array<Assignee>;
};

type Counts = {
    created: number;
    updated: number;
    extended: number;
    unchanged: number;
    ended: number;
    failed: number;
};

function isObject(value: unknown): value is Unknowns {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reduce a Pro Suite dropdown object - { UniqueIdentifier, Description, Code } -
 * or an array of them to a human readable string
 */
function describe(value: unknown, depth = 0): string | null {
    if (value === null || value === undefined || depth > 3) return null;

    if (typeof value === 'string') return value.trim() || null;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);

    if (Array.isArray(value)) {
        const parts = value.map((entry) => describe(entry, depth + 1)).filter((part) => part !== null);
        return parts.length ? parts.join(', ') : null;
    }

    if (!isObject(value)) return null;

    for (const key of ['Description', 'FullDescription', 'Name', 'Abbreviation', 'Code', 'Level']) {
        const found = describe(value[key], depth + 1);
        if (found) return found;
    }

    // Wrapper objects such as { IncidentCode: { Description }, IsPrimary: true }
    for (const nested of Object.values(value)) {
        if (isObject(nested)) {
            const found = describe(nested, depth + 1);
            if (found) return found;
        }
    }

    return null;
}

/**
 * IncidentCode is returned as an array of { IncidentCode, IsPrimary } entries on
 * some deployments and as a single dropdown on others
 */
function primaryIncident(value: unknown): string | null {
    if (Array.isArray(value)) {
        const primary = value.find((entry) => isObject(entry) && entry.IsPrimary === true);
        return describe(primary ?? value[0]);
    }

    return describe(value);
}

/**
 * CAD priorities are agency configured but near universally numbered with 1 as
 * the most urgent - the first number found in the Level, Code or Description
 * is mapped onto the CloudTAK scale, anything else is left unprioritised
 */
function priority(value: Static<typeof CADDropdown> | null | undefined): Priority {
    if (!value) return 'none';

    for (const candidate of [value.Level, value.Code, value.Description]) {
        const match = String(candidate ?? '').match(/\d+/);
        if (!match) continue;

        const level = Number(match[0]);
        if (level <= 1) return 'critical';
        if (level === 2) return 'high';
        if (level === 3) return 'medium';
        return 'low';
    }

    return 'none';
}

function toCoordinate(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num) || num === 0) return null;
    return num;
}

const COORDINATE_CONTAINERS = ['GeneralAddress', 'Address', 'Location', 'IncidentAddress'];
const LATITUDE_KEYS = ['Latitude', 'Lat'];
const LONGITUDE_KEYS = ['Longitude', 'Lon', 'Long'];

function pick(source: Unknowns, keys: string[]): number | null {
    for (const key of keys) {
        const found = toCoordinate(source[key]);
        if (found !== null) return found;
    }

    return null;
}

/**
 * Coordinates are carried either on the record itself (units) or on a nested
 * address object (calls for service) depending on the endpoint
 */
function coordinates(record: Unknowns): [number, number] | null {
    const candidates: Unknowns[] = [record];

    for (const key of COORDINATE_CONTAINERS) {
        const container = record[key];
        if (isObject(container)) candidates.push(container);
    }

    for (const candidate of candidates) {
        const lat = pick(candidate, LATITUDE_KEYS);
        const lon = pick(candidate, LONGITUDE_KEYS);
        if (lat !== null && lon !== null) return [lon, lat];
    }

    return null;
}

/**
 * Agency codes configured on the layer, normalised for comparison
 */
function agencies(env: Static<typeof InputSchema>): Set<string> {
    return new Set(env.Agencies.map((code) => code.trim().toUpperCase()).filter((code) => code.length));
}

/**
 * A record is submitted when any of the Code, Abbreviation or Description values
 * of its DispatchAgency (or Agency) dropdown matches a configured agency code
 */
function allowedAgency(allowed: Set<string>, record: Unknowns): boolean {
    if (!allowed.size) return true;

    for (const agency of [record.DispatchAgency, record.Agency]) {
        if (!isObject(agency)) continue;

        for (const key of ['Code', 'Abbreviation', 'Description']) {
            const value = agency[key];
            if (typeof value === 'string' && allowed.has(value.trim().toUpperCase())) return true;
        }
    }

    return false;
}

/**
 * Records without a usable location are placed at the optional configured
 * fallback so the call or unit is still visible on the map
 */
function fallback(env: Static<typeof InputSchema>): [number, number] | null {
    if (!env.FallbackCoordinates) return null;

    const [lat, lon] = env.FallbackCoordinates.split(',').map((part) => toCoordinate(part.trim()));

    if (lat === null || lat === undefined || lon === null || lon === undefined) {
        console.error(`not ok - invalid FallbackCoordinates: ${env.FallbackCoordinates}`);
        return null;
    }

    return [lon, lat];
}

type BBox = [number, number, number, number];

/**
 * Parse the optional BoundingBox env - minLon,minLat,maxLon,maxLat - returning
 * null when unset so geocoded results are accepted anywhere
 */
function bbox(env: Static<typeof InputSchema>): BBox | null {
    if (!env.BoundingBox) return null;

    const parts = env.BoundingBox.split(',').map((part) => Number(part.trim()));

    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part)) || parts[0] > parts[2] || parts[1] > parts[3]) {
        console.error(`not ok - invalid BoundingBox: ${env.BoundingBox}`);
        return null;
    }

    return parts as BBox;
}

function within(box: BBox | null, [lon, lat]: [number, number]): boolean {
    if (!box) return true;
    return lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];
}

function addressLine(record: Unknowns): string | null {
    for (const key of COORDINATE_CONTAINERS) {
        const container = record[key];
        if (!isObject(container)) continue;

        const freeform = describe(container.FreeFormAddress);
        if (freeform) return freeform;

        const parts = [
            describe(container.Street),
            describe(container.City) ?? describe(container.Community),
            describe(container.State),
            describe(container.Zip)
        ].filter((part) => part !== null);

        if (parts.length) return parts.join(', ');
    }

    return null;
}

function timestamp(value: unknown, fallback: Date): Date {
    return parseTimestamp(value) ?? fallback;
}

function parseTimestamp(value: unknown): Date | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function remarks(lines: Array<string | null>): string {
    return lines.filter((line) => line !== null).join('\n');
}

function clampName(name: string): string {
    return name.length > NAME_MAX_LENGTH ? `${name.slice(0, NAME_MAX_LENGTH - 1)}…` : name;
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function digest(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function statusOf(err: unknown): number | null {
    if (err instanceof Error && 'status' in err && typeof err.status === 'number') return err.status;
    return null;
}

/**
 * Units dispatched to a Call for Service become Assignments on the Event -
 * one per unit, the latest status winning when a unit is listed twice
 */
function assignees(units: Static<typeof CADEvent>['Units']): Array<Assignee> {
    const byName = new Map<string, Assignee>();

    for (const unit of units ?? []) {
        const name = describe(unit.Unit) ?? describe(unit.UnitID);
        if (!name) continue;

        byName.set(clampName(name), {
            name: clampName(name),
            role: describe(unit.UnitStatus) ?? ''
        });
    }

    return [...byName.values()];
}

/**
 * Search responses are wrapped in a paginated envelope keyed by the resource -
 * ie { previous, next, cfs_cores: [] }
 */
function envelope(body: Unknowns, preferred: string): Unknowns[] {
    const candidates: unknown[] = [body[preferred]];

    for (const [key, value] of Object.entries(body)) {
        if (key === 'previous' || key === 'next') continue;
        candidates.push(value);
    }

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate.filter(isObject);
    }

    return [];
}

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

        const base = new URL(env.BaseURL);

        if (env.DataType === DATA_TYPE_UNITS) {
            await this.controlUnits(env, base);
        } else {
            await this.controlCalls(env, base);
        }
    }

    /**
     * AVL unit locations are posted to the map as CoT
     */
    async controlUnits(env: Static<typeof InputSchema>, base: URL): Promise<void> {
        const fc: Static<typeof Feature.InputFeatureCollection> = {
            type: 'FeatureCollection',
            features: []
        };

        const allowed = agencies(env);
        let filtered = 0;

        for (const record of await this.controlSearch(env, base, '/units/search', 'units', {})) {
            if (!allowedAgency(allowed, record)) {
                filtered++;
                continue;
            }

            const feat = this.controlUnit(env, record);
            if (feat) fc.features.push(feat);
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
    async controlCalls(env: Static<typeof InputSchema>, base: URL): Promise<void> {
        const cache = await this.eventCache();
        const seen = new Set<string>();
        const counts: Counts = { created: 0, updated: 0, extended: 0, unchanged: 0, ended: 0, failed: 0 };

        const allowed = agencies(env);
        let filtered = 0;

        const geocoded = new Map<string, [number, number] | null>();

        for (const record of await this.controlSearch(env, base, '/cfs_core/search', 'cfs_cores', { CurrentlyActive: true })) {
            if (!allowedAgency(allowed, record)) {
                filtered++;
                continue;
            }

            const call = await this.controlCFS(env, record, geocoded);
            if (!call || seen.has(call.number)) continue;

            seen.add(call.number);

            try {
                await this.syncCall(env, cache, call, counts);
            } catch (err) {
                counts.failed++;
                console.error(`not ok - CFS ${call.number}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        for (const number of Object.keys(cache)) {
            if (seen.has(number)) continue;

            try {
                await this.api.Event.update(cache[number].id, { active: false });
                counts.ended++;
            } catch (err) {
                if (statusOf(err) !== 404) {
                    counts.failed++;
                    console.error(`not ok - CFS ${number} could not be ended: ${err instanceof Error ? err.message : String(err)}`);
                    continue;
                }
            }

            delete cache[number];
        }

        await this.patchEphemeral({ events: cache });

        if (allowed.size) {
            console.log(`ok - ${filtered} records discarded by Agencies filter (${[...allowed].join(', ')})`);
        }

        console.log(`ok - ${seen.size} active calls: ${counts.created} created, ${counts.updated} updated, ${counts.extended} extended, ${counts.unchanged} unchanged, ${counts.ended} ended, ${counts.failed} failed`);
    }

    /**
     * Create or update the Event for a call. Every write pushes the expiry out
     * by ExpireHours so an Event ends on its own should this layer stop
     * reporting - an unchanged call is only touched once half of that window
     * has elapsed, otherwise it costs no API calls
     */
    async syncCall(env: Static<typeof InputSchema>, cache: Static<typeof EventCache>, call: Call, counts: Counts): Promise<void> {
        const hash = digest({ event: call.event, units: call.units });

        const now = Date.now();
        const window = env.ExpireHours * 60 * 60 * 1000;
        const ended = new Date(now + window).toISOString();

        let cached: Static<typeof EventCache>[string] | undefined = cache[call.number];

        if (!cached) {
            const found = await this.findEvent(call.number);
            if (found) cached = { id: found.id, hash: '' };
        }

        if (cached && cached.hash === hash) {
            const expires = cached.expires ? new Date(cached.expires).getTime() : 0;

            if (expires - now > window / 2) {
                cache[call.number] = cached;
                counts.unchanged++;
                return;
            }

            try {
                await this.api.Event.update(cached.id, { ended });
                cache[call.number] = { ...cached, expires: ended };
                counts.extended++;
                return;
            } catch (err) {
                if (statusOf(err) !== 404) throw err;
                cached = undefined;
                delete cache[call.number];
            }
        }

        let event: CoreEvent | null = null;

        if (cached) {
            try {
                event = await this.api.Event.update(cached.id, { ...call.event, ended });
            } catch (err) {
                if (statusOf(err) !== 404) throw err;
                delete cache[call.number];
            }
        }

        if (event) {
            await this.syncAssignments(event.id, call.units, (await this.api.Assignment.list(event.id, { limit: 100 })).items);
            counts.updated++;
        } else {
            event = await this.api.Event.create({
                ...call.event,
                type: EVENT_SIDC,
                external_id: { system: EXTERNAL_SYSTEM, value: call.number },
                ended,
                editable: true,
                links: [],
                missions: [],
                style: {}
            });

            await this.syncAssignments(event.id, call.units, []);
            counts.created++;
        }

        cache[call.number] = { id: event.id, hash, expires: ended };
    }

    /**
     * Reconcile the Assignments this task manages on an Event with the units
     * currently dispatched - people assigned by users are left untouched
     */
    async syncAssignments(event: string, units: Array<Assignee>, current: Array<CoreEventAssignment>): Promise<void> {
        const managed = new Map(current.filter((a) => a.remarks === ASSIGNMENT_REMARKS).map((a) => [a.name, a]));

        for (const unit of units) {
            const existing = managed.get(unit.name);

            if (!existing) {
                await this.api.Assignment.create(event, { name: unit.name, role: unit.role, remarks: ASSIGNMENT_REMARKS });
            } else {
                managed.delete(unit.name);
                if (existing.role !== unit.role) await this.api.Assignment.update(event, existing.id, { role: unit.role });
            }
        }

        for (const stale of managed.values()) {
            await this.api.Assignment.delete(event, stale.id);
        }
    }

    /**
     * Find the Event previously created for a CFS number when the cache has no
     * record of it - the number is part of the Event name so the name filter
     * narrows the candidates before the external ID is compared
     */
    async findEvent(number: string): Promise<CoreEvent | null> {
        const list = await this.api.Event.list({ filter: escapeRegex(number).slice(0, 64), limit: 100 });

        return list.items.find((item) => item.external_ids[EXTERNAL_SYSTEM] === number) ?? null;
    }

    async eventCache(): Promise<Static<typeof EventCache>> {
        const layer = await this.fetchLayer();

        try {
            return this.type(EventCache, layer.incoming?.ephemeral.events ?? {});
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

    /**
     * Obtain a Bearer Token, reusing the cached token until an hour before it expires
     * The Pro Suite token endpoint is rate limited and authenticating on every
     * invocation will lock the integration out of API access
     */
    async controlToken(env: Static<typeof InputSchema>, base: URL, force = false): Promise<string> {
        const layer = await this.fetchLayer();
        const ephemeral = layer.incoming?.ephemeral ?? {};

        if (
            !force
            && ephemeral.access_token
            && ephemeral.access_token_expires
            && Number(ephemeral.access_token_expires) > +new Date()
        ) {
            return String(ephemeral.access_token);
        }

        console.log('ok - requesting new token');

        const body = new URLSearchParams({
            grant_type: 'password',
            username: env.Username,
            password: env.Password
        });

        if (env.Domain) {
            body.append('domain', env.Domain);
            body.append('client_id', env.Domain);
        }

        const res = await fetch(new URL('/api/token', base), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                From: FROM_HEADER
            },
            body,
            safeUrlAllow: [base.origin]
        });

        if (!res.ok) {
            throw new Error(`Pro Suite Authentication Failed: ${res.status} ${await res.text()}`);
        }

        const token = await res.typed(TokenResponse);

        // Agencies can shorten the token lifetime - never let the margin consume
        // more than half of it or every invocation would re-authenticate
        const lifetime = token.expires_in ? token.expires_in * 1000 : TOKEN_LIFETIME_MS;
        const margin = Math.min(TOKEN_REFRESH_MARGIN_MS, lifetime / 2);

        await this.patchEphemeral({
            access_token: token.access_token,
            access_token_expires: String(+new Date() + lifetime - margin)
        });

        return token.access_token;
    }

    async controlSearch(
        env: Static<typeof InputSchema>,
        base: URL,
        path: string,
        key: string,
        filter: Unknowns
    ): Promise<Unknowns[]> {
        const records: Unknowns[] = [];

        let token = await this.controlToken(env, base);

        // The cached token can be revoked or expired early by the agency - allow
        // a single re-authentication rather than failing the entire invocation
        let refreshed = false;

        for (let page = 0; page < MAX_PAGES; page++) {
            const url = new URL(`/api/cad/latest${path}`, base);
            url.searchParams.set('skip', String(page * PAGE_LIMIT));
            url.searchParams.set('limit', String(PAGE_LIMIT));

            let res = await this.controlPage(env, base, url, token, filter);

            if (res.status === 401 && !refreshed) {
                console.log('ok - cached token rejected, re-authenticating');
                refreshed = true;
                token = await this.controlToken(env, base, true);
                res = await this.controlPage(env, base, url, token, filter);
            }

            if (!res.ok) {
                throw new Error(`Pro Suite ${path} Failed: ${res.status} ${await res.text()}`);
            }

            const body = await res.json() as Unknowns;

            if (env.DEBUG) console.error(`DEBUG - ${path}: ${JSON.stringify(body)}`);

            const items = envelope(body, key);
            records.push(...items);

            if (!body.next || !items.length) break;

            if (page === MAX_PAGES - 1) {
                console.log(`ok - MAX_PAGES (${MAX_PAGES}) reached, ${path} results were truncated`);
            }
        }

        return records;
    }

    async controlPage(
        env: Static<typeof InputSchema>,
        base: URL,
        url: URL,
        token: string,
        filter: Unknowns
    ) {
        return await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                From: FROM_HEADER
            },
            body: JSON.stringify(filter),
            safeUrlAllow: [base.origin]
        });
    }

    /**
     * Geocode a free form address via the CloudTAK Search API - suggest returns a
     * magicKey which forward resolves to a location. Results outside of the
     * configured BoundingBox are rejected. Requires the search:read permission
     *
     * @returns [lon, lat] or null if no acceptable location was found
     */
    async controlGeocode(
        env: Static<typeof InputSchema>,
        address: string,
        cache: Map<string, [number, number] | null>
    ): Promise<[number, number] | null> {
        const cached = cache.get(address);
        if (cached !== undefined) return cached;

        let geometry: [number, number] | null = null;

        try {
            const box = bbox(env);

            const suggest = new URL('/api/search/suggest', this.etl.api);
            suggest.searchParams.set('query', address);
            suggest.searchParams.set('limit', '1');

            if (box) {
                suggest.searchParams.set('longitude', String((box[0] + box[2]) / 2));
                suggest.searchParams.set('latitude', String((box[1] + box[3]) / 2));
            }

            const suggestion = this.type(SuggestResponse, await this.fetch(suggest)).items[0];

            if (suggestion) {
                const forward = new URL('/api/search/forward', this.etl.api);
                forward.searchParams.set('query', suggestion.text);
                forward.searchParams.set('magicKey', suggestion.magicKey);
                forward.searchParams.set('limit', '1');

                const result = this.type(ForwardResponse, await this.fetch(forward)).items[0];

                if (result) {
                    const candidate: [number, number] = [result.location.x, result.location.y];

                    if (within(box, candidate)) {
                        geometry = candidate;
                    } else if (env.DEBUG) {
                        console.error(`DEBUG - geocoded "${address}" to ${candidate.join(',')} which is outside of BoundingBox - rejecting`);
                    }
                }
            }
        } catch (err) {
            console.error(`not ok - geocoding "${address}" failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        if (env.DEBUG) console.error(`DEBUG - geocoded "${address}" => ${geometry ? geometry.join(',') : 'no acceptable result'}`);

        cache.set(address, geometry);

        return geometry;
    }

    async controlCFS(
        env: Static<typeof InputSchema>,
        record: Unknowns,
        geocoded: Map<string, [number, number] | null> = new Map()
    ): Promise<Call | null> {
        const number = describe(record.CFSNumber) ?? describe(record.ExternalCFSNumber);

        let geometry = coordinates(record);

        if (!geometry) {
            const address = addressLine(record);

            if (address) {
                if (env.DEBUG) console.error(`DEBUG - CFS ${number ?? 'Unknown'} has no coordinates - geocoding "${address}"`);
                geometry = await this.controlGeocode(env, address, geocoded);
            }
        }

        if (!geometry) {
            geometry = fallback(env);
            if (env.DEBUG) console.error(`DEBUG - CFS ${number ?? 'Unknown'} has no coordinates${geometry ? ' - using fallback' : ''}`);
            if (!geometry) return null;
        }

        if (!number) return null;

        let cfs: Static<typeof CADEvent>;

        try {
            cfs = this.type(CADEvent, record);
        } catch (err) {
            console.error(`not ok - skipping CFS ${number}: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }

        const start = parseTimestamp(cfs.CallDateTime ?? cfs.IncidentDateTime);

        const incident = primaryIncident(cfs.IncidentCode);

        return {
            number,
            event: {
                name: clampName(incident ? `${incident} (${number})` : number),
                priority: priority(cfs.Priority),
                geometry: {
                    type: 'Point',
                    coordinates: geometry
                },
                location: addressLine(record) ?? '',
                started: start?.toISOString(),
                remarks: remarks([
                    `CFS: ${number}`,
                    incident ? `Incident: ${incident}` : null,
                    describe(cfs.CFSStatus) ? `Status: ${describe(cfs.CFSStatus)}` : null,
                    describe(cfs.Priority) ? `Priority: ${describe(cfs.Priority)}` : null,
                    cfs.NearestCrossStreet ? `Cross Street: ${cfs.NearestCrossStreet}` : null,
                    cfs.NearestIntersection ? `Intersection: ${cfs.NearestIntersection}` : null,
                    describe(cfs.DispatchAgency) ? `Agency: ${describe(cfs.DispatchAgency)}` : null,
                    describe(cfs.Zone) ? `Zone: ${describe(cfs.Zone)}` : null,
                    describe(cfs.Beat) ? `Beat: ${describe(cfs.Beat)}` : null,
                    describe(cfs.PrimaryOfficer) ? `Primary Officer: ${describe(cfs.PrimaryOfficer)}` : null,
                    describe(cfs.Reporter?.FreeformFullName) ? `Reporter: ${describe(cfs.Reporter?.FreeformFullName)}` : null,
                    describe(cfs.Reporter?.ContactPhoneNumber ?? cfs.Reporter?.FromPhoneNumber) ? `Phone: ${describe(cfs.Reporter?.ContactPhoneNumber ?? cfs.Reporter?.FromPhoneNumber)}` : null,
                    describe(cfs.Disposition) ? `Disposition: ${describe(cfs.Disposition)}` : null,
                    cfs.UseCaution ? 'Use Caution' : null
                ]),
                metadata: cfs
            },
            units: assignees(cfs.Units)
        };
    }

    controlUnit(
        env: Static<typeof InputSchema>,
        record: Unknowns
    ): Static<typeof Feature.InputFeature> | null {
        const geometry = coordinates(record) ?? fallback(env);

        const identifier = describe(record.UnitID)
            ?? describe(record.UniqueIdentifier)
            ?? describe(record.UnitName)
            ?? describe(record.Unit);

        if (!geometry || !identifier) return null;

        let unit: Static<typeof CADUnit>;

        try {
            unit = this.type(CADUnit, record);
        } catch (err) {
            console.error(`not ok - skipping Unit ${identifier}: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }

        const now = new Date();
        const start = timestamp(unit.LocationDateTime, now);

        const callsign = describe(unit.UnitName) ?? describe(unit.Unit) ?? identifier;

        return {
            id: `central-square-unit-${identifier}`,
            type: 'Feature',
            properties: {
                callsign,
                type: 'a-f-G-E-V',
                how: 'm-g',
                time: start.toISOString(),
                start: start.toISOString(),
                stale: new Date(now.getTime() + STALE_MINUTES * 60 * 1000).toISOString(),
                track: (unit.Speed !== undefined && unit.Speed !== null) || (unit.Heading !== undefined && unit.Heading !== null) ? {
                    speed: unit.Speed !== undefined && unit.Speed !== null ? String(unit.Speed) : undefined,
                    course: unit.Heading !== undefined && unit.Heading !== null ? String(unit.Heading) : undefined
                } : undefined,
                remarks: remarks([
                    `Unit: ${callsign}`,
                    describe(unit.UnitStatus ?? unit.Status) ? `Status: ${describe(unit.UnitStatus ?? unit.Status)}` : null,
                    describe(unit.DispatchAgency ?? unit.Agency) ? `Agency: ${describe(unit.DispatchAgency ?? unit.Agency)}` : null,
                    describe(unit.Zone) ? `Zone: ${describe(unit.Zone)}` : null,
                    describe(unit.Beat) ? `Beat: ${describe(unit.Beat)}` : null,
                    unit.CFSNumber ? `CFS: ${unit.CFSNumber}` : null,
                    describe(unit.Personnel) ? `Personnel: ${describe(unit.Personnel)}` : null,
                    addressLine(record) ? `Location: ${addressLine(record)}` : null
                ]) || undefined,
                metadata: unit
            },
            geometry: {
                type: 'Point',
                coordinates: geometry
            }
        };
    }
}

await local(await Task.init(import.meta.url), import.meta.url);
export async function handler(event: Event = {}) {
    return await internal(await Task.init(import.meta.url), event);
}
