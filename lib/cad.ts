import type { Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { Feature } from '@tak-ps/node-cot';
import { CADDropdown, CADEvent, CADUnit, isObject } from './central-square.js';
import type { Unknowns } from './central-square.js';
import { EventSync } from './events.js';
import type { Assignee, Priority, SyncedCall } from './events.js';

/** MIL-STD-2525E Incident symbol - the CloudTAK default for a new Event */
export const EVENT_SIDC = '10034000001100000000';

export const STALE_MINUTES = 20;

export type Coordinate = [number, number];

export type BBox = [number, number, number, number];

const COORDINATE_CONTAINERS = ['GeneralAddress', 'Address', 'Location', 'IncidentAddress'];
const LATITUDE_KEYS = ['Latitude', 'Lat'];
const LONGITUDE_KEYS = ['Longitude', 'Lon', 'Long'];
const PLACEHOLDERS = new Set(['unknown', 'unk', 'n/a', 'na', 'none', 'null', 'undefined']);

/**
 * Reduce a Pro Suite dropdown object - { UniqueIdentifier, Description, Code } -
 * or an array of them to a human readable string
 */
export function describe(value: unknown, depth = 0): string | null {
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
export function primaryIncident(value: unknown): string | null {
    if (Array.isArray(value)) {
        const primary = value.find((entry) => isObject(entry) && entry.IsPrimary === true);
        return describe(primary ?? value[0]);
    }

    return describe(value);
}

/**
 * The first of the Level, Code or Description values that maps onto the
 * CloudTAK priority scale wins
 */
export function priority(value: Static<typeof CADDropdown> | null | undefined): Priority {
    if (!value) return 'none';

    for (const candidate of [value.Level, value.Code, value.Description]) {
        if (candidate === null || candidate === undefined) continue;

        const found = EventSync.priorityOf(String(candidate));
        if (found !== 'none') return found;
    }

    return 'none';
}

function toCoordinate(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num) || num === 0) return null;
    return num;
}

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
export function coordinates(record: Unknowns): Coordinate | null {
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
 * CAD dropdowns commonly carry an "Unknown" entry which would otherwise be
 * sent to the geocoder as a literal address component
 */
export function addressPart(value: unknown): string | null {
    const part = describe(value);
    if (part === null || PLACEHOLDERS.has(part.toLowerCase())) return null;
    return part;
}

export function addressLine(record: Unknowns): string | null {
    for (const key of COORDINATE_CONTAINERS) {
        const container = record[key];
        if (!isObject(container)) continue;

        const freeform = addressPart(container.FreeFormAddress);
        if (freeform) return freeform;

        const parts = [
            addressPart(container.Street),
            addressPart(container.City) ?? addressPart(container.Community),
            addressPart(container.State),
            addressPart(container.Zip)
        ].filter((part) => part !== null);

        if (parts.length) return parts.join(', ');
    }

    return null;
}

export function parseTimestamp(value: unknown): Date | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function remarks(lines: Array<string | null>): string {
    return lines.filter((line) => line !== null).join('\n');
}

/**
 * Agency codes configured on the layer, normalised for comparison
 */
export function parseAgencies(codes: string[]): Set<string> {
    return new Set(codes.map((code) => code.trim().toUpperCase()).filter((code) => code.length));
}

/**
 * A record is submitted when any of the Code, Abbreviation or Description values
 * of its DispatchAgency (or Agency) dropdown matches a configured agency code
 */
export function allowedAgency(allowed: Set<string>, record: Unknowns): boolean {
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
 * Parse a Latitude,Longitude input - records without a usable location are
 * placed here so the call or unit is still visible on the map
 */
export function parseFallback(value: string | undefined): Coordinate | null {
    if (!value) return null;

    const [lat, lon] = value.split(',').map((part) => toCoordinate(part.trim()));

    if (lat === null || lat === undefined || lon === null || lon === undefined) {
        console.error(`not ok - invalid FallbackCoordinates: ${value}`);
        return null;
    }

    return [lon, lat];
}

/**
 * Parse a minLon,minLat,maxLon,maxLat input - null when unset so geocoded
 * results are accepted anywhere
 */
export function parseBBox(value: string | undefined): BBox | null {
    if (!value) return null;

    const parts = value.split(',').map((part) => Number(part.trim()));

    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part)) || parts[0] > parts[2] || parts[1] > parts[3]) {
        console.error(`not ok - invalid BoundingBox: ${value}`);
        return null;
    }

    return parts as BBox;
}

export function within(box: BBox | null, [lon, lat]: Coordinate): boolean {
    if (!box) return true;
    return lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];
}

/**
 * Validate a raw record against its schema, dropping the fields the schema
 * does not model so only the modelled subset is attached as metadata
 */
export function parseRecord<T extends TSchema>(schema: T, record: Unknowns): Static<T> {
    return Value.Parse(['Clone', 'Default', 'Clean', 'Convert', 'Assert'], schema, record);
}

export function cfsNumber(record: Unknowns): string | null {
    return describe(record.CFSNumber) ?? describe(record.ExternalCFSNumber);
}

export function unitIdentifier(record: Unknowns): string | null {
    return describe(record.UnitID)
        ?? describe(record.UniqueIdentifier)
        ?? describe(record.UnitName)
        ?? describe(record.Unit);
}

export const CALL_TAKER_ROLE = 'Call Taker';

/**
 * Units dispatched to a Call for Service become Assignments on the Event -
 * one per unit, the latest status winning when a unit is listed twice - along
 * with the dispatcher who took the call
 */
export function assignees(cfs: Pick<Static<typeof CADEvent>, 'Units' | 'CallTaker'>): Array<Assignee> {
    const byName = new Map<string, Assignee>();

    for (const unit of cfs.Units ?? []) {
        const name = describe(unit.Unit) ?? describe(unit.UnitID);
        if (!name) continue;

        byName.set(EventSync.clampName(name), {
            name: EventSync.clampName(name),
            role: describe(unit.UnitStatus) ?? ''
        });
    }

    const taker = describe(cfs.CallTaker);

    if (taker && !byName.has(EventSync.clampName(taker))) {
        byName.set(EventSync.clampName(taker), {
            name: EventSync.clampName(taker),
            role: CALL_TAKER_ROLE
        });
    }

    return [...byName.values()];
}

/**
 * Map a Call for Service record to the Event written to CloudTAK - the record
 * is validated here and a malformed one throws
 */
export function callOf(number: string, record: Unknowns, geometry: Coordinate): SyncedCall {
    const cfs = parseRecord(CADEvent, record);

    const incident = primaryIncident(cfs.IncidentCode);
    const phone = cfs.Reporter?.ContactPhoneNumber ?? cfs.Reporter?.FromPhoneNumber;

    return {
        external: number,
        event: {
            name: EventSync.clampName(incident ? `${incident} (${number})` : number),
            type: EVENT_SIDC,
            priority: priority(cfs.Priority),
            geometry: {
                type: 'Point',
                coordinates: geometry
            },
            location: addressLine(record) ?? '',
            started: parseTimestamp(cfs.CallDateTime ?? cfs.IncidentDateTime)?.toISOString(),
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
                describe(phone) ? `Phone: ${describe(phone)}` : null,
                describe(cfs.Disposition) ? `Disposition: ${describe(cfs.Disposition)}` : null,
                cfs.UseCaution ? 'Use Caution' : null
            ]),
            metadata: cfs
        },
        assignees: assignees(cfs)
    };
}

/**
 * Map an AVL unit record to a CoT Feature - the record is validated here and
 * a malformed one throws
 */
export function unitFeature(
    identifier: string,
    record: Unknowns,
    geometry: Coordinate,
    now = new Date()
): Static<typeof Feature.InputFeature> {
    const unit = parseRecord(CADUnit, record);

    const start = parseTimestamp(unit.LocationDateTime) ?? now;
    const callsign = describe(unit.UnitName) ?? describe(unit.Unit) ?? identifier;

    const speed = unit.Speed !== undefined && unit.Speed !== null ? String(unit.Speed) : undefined;
    const course = unit.Heading !== undefined && unit.Heading !== null ? String(unit.Heading) : undefined;

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
            track: speed !== undefined || course !== undefined ? { speed, course } : undefined,
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
