import type { Static, TSchema } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import type { Event } from '@tak-ps/etl';
import { Feature } from '@tak-ps/node-cot'
import ETL, { SchemaType, handler as internal, local, DataFlowType, InvocationType } from '@tak-ps/etl';

import { fetch } from '@tak-ps/etl';

const Nullable = <T extends TSchema>(type: T) => Type.Union([Type.Null(), type]);

const DATA_TYPE_CFS = 'Calls for Service';
const DATA_TYPE_UNITS = 'Units';

/**
 * The Input Schema contains the environment object that will be requested via the CloudTAK UI
 * It should be a valid TypeBox object - https://github.com/sinclairzx81/typebox
 */
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
        description: 'Calls for Service posts CFS incident locations, Units posts AVL unit locations'
    }),
    FallbackCoordinates: Type.Optional(Type.String({
        description: 'Latitude,Longitude used for records without coordinates - ie 39.7392,-104.9903'
    })),
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

/**
 * Pro Suite is configured per agency and the CFS record exposes a superset of
 * these fields - everything is optional so a single missing or agency specific
 * value never discards an otherwise usable call
 */
const CFSCore = Type.Object({
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
    Units: Type.Optional(Nullable(Type.Array(Type.Object({
        UnitID: Type.Optional(Nullable(Type.Union([Type.String(), Type.Number()]))),
        Unit: Type.Optional(Nullable(CADDropdown)),
        UnitStatus: Type.Optional(Nullable(CADDropdown))
    }))))
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

const TokenResponse = Type.Object({
    access_token: Type.String(),
    token_type: Type.Optional(Type.String()),
    expires_in: Type.Optional(Type.Integer())
});

// Pro Suite tokens default to a 24 hour lifetime and the token endpoint is
// aggressively rate limited - refresh early rather than on every call
const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 60 * 60 * 1000;

const PAGE_LIMIT = 100;
const MAX_PAGES = 20;
const STALE_MINUTES = 20;

// Required on every request and recorded in the Pro Suite audit trail
const FROM_HEADER = 'CloudTAK-ETL';

type Unknowns = Record<string, unknown>;

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
    if (typeof value !== 'string' || !value.trim()) return fallback;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function remarks(lines: Array<string | null>): string | undefined {
    const body = lines.filter((line) => line !== null).join('\n');
    return body || undefined;
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
    ): Promise<TSchema> {
        if (flow === DataFlowType.Incoming) {
            if (type === SchemaType.Input) {
                return InputSchema;
            } else {
                const env = await this.env(InputSchema);
                return env.DataType === DATA_TYPE_UNITS ? CADUnit : CFSCore;
            }
        } else {
            return Type.Object({});
        }
    }

    async control(): Promise<void> {
        const env = await this.env(InputSchema);

        const base = new URL(env.BaseURL);

        const fc: Static<typeof Feature.InputFeatureCollection> = {
            type: 'FeatureCollection',
            features: []
        };

        if (env.DataType === DATA_TYPE_UNITS) {
            for (const record of await this.controlSearch(env, base, '/units/search', 'units', {})) {
                const feat = this.controlUnit(env, record);
                if (feat) fc.features.push(feat);
            }
        } else {
            for (const record of await this.controlSearch(env, base, '/cfs_core/search', 'cfs_cores', { CurrentlyActive: true })) {
                const feat = this.controlCFS(env, record);
                if (feat) fc.features.push(feat);
            }
        }

        console.log(`ok - obtained ${fc.features.length} features`);

        await this.submit(fc);
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

        await this.setEphemeral({
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

    controlCFS(
        env: Static<typeof InputSchema>,
        record: Unknowns
    ): Static<typeof Feature.InputFeature> | null {
        const number = describe(record.CFSNumber) ?? describe(record.ExternalCFSNumber);

        let geometry = coordinates(record);

        if (!geometry) {
            geometry = fallback(env);
            if (env.DEBUG) console.error(`DEBUG - CFS ${number ?? 'Unknown'} has no coordinates${geometry ? ' - using fallback' : ''}`);
            if (!geometry) return null;
        }

        if (!number) return null;

        let cfs: Static<typeof CFSCore>;

        try {
            cfs = this.type(CFSCore, record);
        } catch (err) {
            console.error(`not ok - skipping CFS ${number}: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }

        const now = new Date();
        const start = timestamp(cfs.CallDateTime ?? cfs.IncidentDateTime, now);

        const incident = primaryIncident(cfs.IncidentCode);

        return {
            id: `central-square-cfs-${number}`,
            type: 'Feature',
            properties: {
                callsign: incident ? `${incident} (${number})` : number,
                type: 'a-f-G-U-i',
                how: 'h-g-i-g-o',
                time: start.toISOString(),
                start: start.toISOString(),
                stale: new Date(now.getTime() + STALE_MINUTES * 60 * 1000).toISOString(),
                remarks: remarks([
                    `CFS: ${number}`,
                    incident ? `Incident: ${incident}` : null,
                    describe(cfs.CFSStatus) ? `Status: ${describe(cfs.CFSStatus)}` : null,
                    describe(cfs.Priority) ? `Priority: ${describe(cfs.Priority)}` : null,
                    addressLine(record) ? `Address: ${addressLine(record)}` : null,
                    cfs.NearestCrossStreet ? `Cross Street: ${cfs.NearestCrossStreet}` : null,
                    cfs.NearestIntersection ? `Intersection: ${cfs.NearestIntersection}` : null,
                    describe(cfs.DispatchAgency) ? `Agency: ${describe(cfs.DispatchAgency)}` : null,
                    describe(cfs.Zone) ? `Zone: ${describe(cfs.Zone)}` : null,
                    describe(cfs.Beat) ? `Beat: ${describe(cfs.Beat)}` : null,
                    describe(cfs.Units) ? `Units: ${describe(cfs.Units)}` : null,
                    describe(cfs.PrimaryOfficer) ? `Primary Officer: ${describe(cfs.PrimaryOfficer)}` : null,
                    describe(cfs.Reporter?.FreeformFullName) ? `Reporter: ${describe(cfs.Reporter?.FreeformFullName)}` : null,
                    describe(cfs.Reporter?.ContactPhoneNumber ?? cfs.Reporter?.FromPhoneNumber) ? `Phone: ${describe(cfs.Reporter?.ContactPhoneNumber ?? cfs.Reporter?.FromPhoneNumber)}` : null,
                    describe(cfs.Disposition) ? `Disposition: ${describe(cfs.Disposition)}` : null,
                    cfs.UseCaution ? 'Use Caution' : null
                ]),
                metadata: cfs
            },
            geometry: {
                type: 'Point',
                coordinates: geometry
            }
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
                ]),
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
