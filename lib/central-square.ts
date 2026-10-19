import type { TSchema } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import { fetch } from '@tak-ps/etl';

// Pro Suite tokens default to a 24 hour lifetime and the token endpoint is
// aggressively rate limited - refresh early rather than on every call
const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 60 * 60 * 1000;

export const PAGE_LIMIT = 100;
export const MAX_PAGES = 20;

const CALLS_PATH = '/cfs_core/search';
const UNITS_PATH = '/units/search';

// Required on every request and recorded in the Pro Suite audit trail
const FROM_HEADER = 'CloudTAK-ETL';

const Nullable = <T extends TSchema>(type: T) => Type.Union([Type.Null(), type]);

export const CADDropdown = Type.Object({
    UniqueIdentifier: Type.Optional(Nullable(Type.Union([Type.String(), Type.Number()]))),
    Description: Type.Optional(Nullable(Type.String())),
    FullDescription: Type.Optional(Nullable(Type.String())),
    Code: Type.Optional(Nullable(Type.String())),
    Abbreviation: Type.Optional(Nullable(Type.String())),
    Level: Type.Optional(Nullable(Type.Union([Type.String(), Type.Number()]))),
    ORI: Type.Optional(Nullable(Type.String()))
});

export const CADAddress = Type.Object({
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

export const CADIncidentCode = Type.Object({
    IncidentCode: Type.Optional(Nullable(CADDropdown)),
    IsPrimary: Type.Optional(Nullable(Type.Boolean())),
    UniqueIdentifier: Type.Optional(Nullable(Type.Union([Type.String(), Type.Number()]))),
    Description: Type.Optional(Nullable(Type.String())),
    Code: Type.Optional(Nullable(Type.String()))
});

export const CADUnitAssignment = Type.Object({
    UnitID: Type.Optional(Nullable(Type.Union([Type.String(), Type.Number()]))),
    Unit: Type.Optional(Nullable(CADDropdown)),
    UnitStatus: Type.Optional(Nullable(CADDropdown))
});

/**
 * Pro Suite is configured per agency and the CFS record exposes a superset of
 * these fields - everything is optional so a single missing or agency specific
 * value never discards an otherwise usable call
 */
export const CADEvent = Type.Object({
    CFSNumber: Type.Optional(Nullable(Type.String())),
    ExternalCFSNumber: Type.Optional(Nullable(Type.String())),
    CallDateTime: Type.Optional(Nullable(Type.String())),
    IncidentDateTime: Type.Optional(Nullable(Type.String())),
    ClosedDateTime: Type.Optional(Nullable(Type.String())),
    CurrentlyActive: Type.Optional(Nullable(Type.Boolean())),
    UseCaution: Type.Optional(Nullable(Type.Boolean())),
    DispatchAgency: Type.Optional(Nullable(CADDropdown)),
    PrimaryResponseAgency: Type.Optional(Nullable(CADDropdown)),
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
export const CADUnit = Type.Object({
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

export type Unknowns = Record<string, unknown>;

export type Token = {
    access_token: string;
    expires: number;
};

export type CentralSquareOptions = {
    url: string;
    username: string;
    password: string;
    /** Active Directory domain - only required for agencies using LDAP authentication */
    domain?: string;
    debug?: boolean;
    /** Previously issued token - ignored once expired */
    token?: Partial<Token>;
    /** Called with every newly issued token so that it can be cached */
    onToken?: (token: Token) => Promise<void>;
};

export function isObject(value: unknown): value is Unknowns {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Search responses are wrapped in a paginated envelope keyed by the resource -
 * ie { previous, next, cfs_cores: [] }
 */
export function envelope(body: Unknowns, preferred: string): Unknowns[] {
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

/**
 * Thin client over the Pro Suite CAD search endpoints this task uses
 */
export default class CentralSquare {
    base: URL;
    username: string;
    password: string;
    domain?: string;
    debug: boolean;
    token?: string;
    refreshed = false;
    onToken?: (token: Token) => Promise<void>;

    constructor(opts: CentralSquareOptions) {
        this.base = new URL(opts.url);
        this.username = opts.username;
        this.password = opts.password;
        this.domain = opts.domain;
        this.debug = opts.debug ?? false;
        this.onToken = opts.onToken;

        if (opts.token?.access_token && opts.token.expires && opts.token.expires > +new Date()) {
            this.token = opts.token.access_token;
        }
    }

    /** Currently active Calls for Service - POST /api/cad/latest/cfs_core/search */
    async calls(): Promise<Unknowns[]> {
        return await this.search(CALLS_PATH, 'cfs_cores', { CurrentlyActive: true });
    }

    /** AVL unit locations - POST /api/cad/latest/units/search */
    async units(): Promise<Unknowns[]> {
        return await this.search(UNITS_PATH, 'units', {});
    }

    /**
     * Obtain a Bearer Token, expiring it early so the cache is refreshed before
     * Pro Suite rejects it. Authenticating on every invocation will lock the
     * integration out of API access
     */
    async authenticate(): Promise<string> {
        console.log('ok - requesting new token');

        const body = new URLSearchParams({
            grant_type: 'password',
            username: this.username,
            password: this.password
        });

        if (this.domain) {
            body.append('domain', this.domain);
            body.append('client_id', this.domain);
        }

        const res = await fetch(new URL('/api/token', this.base), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                From: FROM_HEADER
            },
            body,
            safeUrlAllow: [this.base.origin]
        });

        if (!res.ok) {
            throw new Error(`Pro Suite Authentication Failed: ${res.status} ${await res.text()}`);
        }

        const token = await res.typed(TokenResponse);

        // Agencies can shorten the token lifetime - never let the margin consume
        // more than half of it or every invocation would re-authenticate
        const lifetime = token.expires_in ? token.expires_in * 1000 : TOKEN_LIFETIME_MS;
        const margin = Math.min(TOKEN_REFRESH_MARGIN_MS, lifetime / 2);

        this.token = token.access_token;

        if (this.onToken) {
            await this.onToken({
                access_token: token.access_token,
                expires: +new Date() + lifetime - margin
            });
        }

        return this.token;
    }

    /** Authenticated POST - a single re-authentication is attempted if the token is rejected */
    async post(url: URL, filter: Unknowns) {
        let res = await this.request(url, this.token ?? await this.authenticate(), filter);

        if (res.status === 401 && !this.refreshed) {
            console.log('ok - cached token rejected, re-authenticating');
            this.refreshed = true;
            res = await this.request(url, await this.authenticate(), filter);
        }

        return res;
    }

    /**
     * Walk the skip/limit pagination of a search endpoint. Any page failure
     * throws so that a partial snapshot is never returned
     */
    async search(path: string, key: string, filter: Unknowns): Promise<Unknowns[]> {
        const records: Unknowns[] = [];

        for (let page = 0; page < MAX_PAGES; page++) {
            const url = new URL(`/api/cad/latest${path}`, this.base);
            url.searchParams.set('skip', String(page * PAGE_LIMIT));
            url.searchParams.set('limit', String(PAGE_LIMIT));

            const res = await this.post(url, filter);

            if (!res.ok) {
                throw new Error(`Pro Suite ${path} Failed: ${res.status} ${await res.text()}`);
            }

            const body = await res.json() as unknown;

            if (this.debug) console.error(`DEBUG - ${path}: ${JSON.stringify(body)}`);

            if (!isObject(body)) {
                throw new Error(`Pro Suite ${path} returned an unexpected response shape`);
            }

            const items = envelope(body, key);
            records.push(...items);

            if (!body.next || !items.length) break;

            if (page === MAX_PAGES - 1) {
                console.log(`ok - MAX_PAGES (${MAX_PAGES}) reached, ${path} results were truncated`);
            }
        }

        return records;
    }

    private async request(url: URL, token: string, filter: Unknowns) {
        return await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                From: FROM_HEADER
            },
            body: JSON.stringify(filter),
            safeUrlAllow: [this.base.origin]
        });
    }
}
