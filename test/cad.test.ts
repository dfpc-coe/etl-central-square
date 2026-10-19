import test from 'node:test';
import assert from 'node:assert';
import {
    addressLine,
    allowedAgency,
    assignees,
    callOf,
    cfsNumber,
    coordinates,
    describe,
    parseAgencies,
    parseBBox,
    parseFallback,
    primaryIncident,
    priority,
    unitFeature,
    unitIdentifier,
    within,
    EVENT_SIDC
} from '../lib/cad.js';

/** Trimmed from a live KCCSO cfs_core/search response */
const KCCSO = {
    CFSNumber: 'CFS2612517',
    DispatchAgency: {
        UniqueIdentifier: 1,
        Abbreviation: 'KCCSO',
        Name: "KIT CARSON COUNTY SHERIFF'S OFFICE",
        ORI: 'CO0320000',
        RunsDispatch: true
    },
    Status: 'waiting',
    IncidentDateTime: '2026-10-16T21:57:59.448138Z',
    CallDateTime: '2026-10-16T21:57:59.448138Z',
    CallTaker: { Username: 'rduran', UniqueIdentifier: 1294, FullDescription: 'COM8 - Duran, Rubi' },
    Priority: { UniqueIdentifier: 2, Description: 'Priority 2', Level: 2 },
    IncidentCode: [
        { IncidentCode: { Description: 'Welfare Check', Code: 'WC' }, IsPrimary: false },
        { IncidentCode: { Description: 'Structure Fire', Code: 'SF' }, IsPrimary: true }
    ],
    Reporter: {
        FreeformFullName: null,
        FromPhoneNumber: '(719) 342-1675',
        ContactPhoneNumber: null,
        Last: 'HUGHES',
        First: 'JULIE'
    },
    Address: {
        Street: '610 COLORADO AVE',
        CrossStreetOne: 'COLORADO AVE',
        City: 'STRATTON',
        State: { UniqueIdentifier: 'CO', Description: 'Colorado' },
        Zip: '80836',
        Latitude: null,
        Longitude: null,
        LocationNotes: []
    },
    Units: [
        { UnitID: 'K1', Unit: { Description: 'K1' }, UnitStatus: { Description: 'Dispatched' } },
        { UnitID: 'K1', Unit: { Description: 'K1' }, UnitStatus: { Description: 'En Route' } },
        { UnitID: 'K2', Unit: null, UnitStatus: null }
    ]
};

test('describe', () => {
    assert.equal(describe(null), null);
    assert.equal(describe('  '), null);
    assert.equal(describe(' E1 '), 'E1');
    assert.equal(describe(3), '3');
    assert.equal(describe({ UniqueIdentifier: 1, Description: 'Fire' }), 'Fire');
    assert.equal(describe({ Abbreviation: 'KCCSO', Name: 'Kit Carson' }), 'Kit Carson');
    assert.equal(describe({ IncidentCode: { Description: 'Fire' }, IsPrimary: true }), 'Fire');
    assert.equal(describe([{ Description: 'A' }, { Description: 'B' }]), 'A, B');
    assert.equal(describe({ Nested: { Nested: { Nested: { Nested: { Description: 'deep' } } } } }), null);
});

test('primaryIncident', () => {
    assert.equal(primaryIncident(KCCSO.IncidentCode), 'Structure Fire');
    assert.equal(primaryIncident([{ IncidentCode: { Description: 'First' } }, { IncidentCode: { Description: 'Second' } }]), 'First');
    assert.equal(primaryIncident({ Description: 'Single' }), 'Single');
    assert.equal(primaryIncident(null), null);
});

test('priority', () => {
    assert.equal(priority(null), 'none');
    assert.equal(priority({ Level: 1 }), 'critical');
    assert.equal(priority({ Code: 'P2' }), 'high');
    assert.equal(priority({ Description: 'Priority 3' }), 'medium');
    assert.equal(priority({ Level: '9' }), 'low');
    assert.equal(priority({ Description: 'High' }), 'high');
    assert.equal(priority({ Description: 'Routine' }), 'none');
    assert.equal(priority({ Level: null, Code: null, Description: '1 - Emergency' }), 'critical');
});

test('coordinates & addressLine', () => {
    assert.equal(coordinates(KCCSO), null);
    assert.deepEqual(coordinates({ Latitude: 39.5, Longitude: -105.1 }), [-105.1, 39.5]);
    assert.deepEqual(coordinates({ Address: { Lat: '39.5', Lon: '-105.1' } }), [-105.1, 39.5]);
    assert.equal(coordinates({ Latitude: 0, Longitude: 0 }), null);
    assert.equal(coordinates({ Latitude: 'abc', Longitude: -105 }), null);

    assert.equal(addressLine(KCCSO), '610 COLORADO AVE, STRATTON, Colorado, 80836');
    assert.equal(addressLine({ Location: { FreeFormAddress: ' 1 Main St ' } }), '1 Main St');
    assert.equal(addressLine({ Address: { Community: 'Town', State: 'CO' } }), 'Town, CO');
    assert.equal(addressLine({}), null);
});

test('agency filter', () => {
    assert.deepEqual([...parseAgencies([' kccso ', '', 'BVFD'])], ['KCCSO', 'BVFD']);

    assert.equal(allowedAgency(new Set(), KCCSO), true);
    assert.equal(allowedAgency(parseAgencies(['kccso']), KCCSO), true);
    assert.equal(allowedAgency(parseAgencies(['BVFD']), KCCSO), false);
    assert.equal(allowedAgency(parseAgencies(['BVFD']), { Agency: { Code: 'bvfd' } }), true);
    assert.equal(allowedAgency(parseAgencies(['BVFD']), { Agency: { Description: 'BVFD' } }), true);
    assert.equal(allowedAgency(parseAgencies(['BVFD']), { PrimaryResponseAgency: { Abbreviation: 'BVFD' } }), false);
    assert.equal(allowedAgency(parseAgencies(['BVFD']), {}), false);
});

test('parseFallback, parseBBox & within', () => {
    assert.equal(parseFallback(undefined), null);
    assert.equal(parseFallback('garbage'), null);
    assert.equal(parseFallback('39.7'), null);
    assert.deepEqual(parseFallback('39.7392, -104.9903'), [-104.9903, 39.7392]);

    assert.equal(parseBBox(undefined), null);
    assert.equal(parseBBox('1,2,3'), null);
    assert.equal(parseBBox('-104,40,-105,39'), null);
    assert.deepEqual(parseBBox('-105.4,39.5,-104.6,40.0'), [-105.4, 39.5, -104.6, 40]);

    const box = parseBBox('-105.4,39.5,-104.6,40.0');
    assert.equal(within(null, [0, 0]), true);
    assert.equal(within(box, [-105, 39.7]), true);
    assert.equal(within(box, [-106, 39.7]), false);
});

test('cfsNumber, unitIdentifier & assignees', () => {
    assert.equal(cfsNumber(KCCSO), 'CFS2612517');
    assert.equal(cfsNumber({ ExternalCFSNumber: 'X1' }), 'X1');
    assert.equal(cfsNumber({}), null);

    assert.equal(unitIdentifier({ UnitID: 12, UnitName: 'E1' }), '12');
    assert.equal(unitIdentifier({ Unit: { Description: 'E1' } }), 'E1');
    assert.equal(unitIdentifier({}), null);

    assert.deepEqual(assignees({ Units: KCCSO.Units, CallTaker: KCCSO.CallTaker }), [
        { name: 'K1', role: 'En Route' },
        { name: 'K2', role: '' },
        { name: 'COM8 - Duran, Rubi', role: 'Call Taker' }
    ]);
    assert.deepEqual(assignees({ Units: null, CallTaker: { Description: 'Dispatcher' } }), [{ name: 'Dispatcher', role: 'Call Taker' }]);
    assert.deepEqual(assignees({ Units: [{ UnitID: 'K1', UnitStatus: { Description: 'On Scene' } }], CallTaker: { Description: 'K1' } }), [{ name: 'K1', role: 'On Scene' }]);
    assert.deepEqual(assignees({}), []);
});

test('callOf', () => {
    const call = callOf('CFS2612517', KCCSO, [-102.6, 39.3]);

    assert.equal(call.external, 'CFS2612517');
    assert.equal(call.event.name, 'Structure Fire (CFS2612517)');
    assert.equal(call.event.type, EVENT_SIDC);
    assert.equal(call.event.priority, 'high');
    assert.deepEqual(call.event.geometry, { type: 'Point', coordinates: [-102.6, 39.3] });
    assert.equal(call.event.location, '610 COLORADO AVE, STRATTON, Colorado, 80836');
    assert.equal(call.event.started, '2026-10-16T21:57:59.448Z');
    assert.equal(call.event.remarks, [
        'CFS: CFS2612517',
        'Incident: Structure Fire',
        'Priority: Priority 2',
        'Agency: KCCSO',
        'Phone: (719) 342-1675'
    ].join('\n'));
    assert.deepEqual(call.assignees, [{ name: 'K1', role: 'En Route' }, { name: 'K2', role: '' }, { name: 'COM8 - Duran, Rubi', role: 'Call Taker' }]);

    // Only modelled fields are kept as metadata & the source record is untouched
    const metadata = call.event.metadata as Record<string, unknown>;
    assert.equal(metadata.CFSNumber, 'CFS2612517');
    assert.equal('Status' in metadata, false);
    assert.equal('CrossStreetOne' in (metadata.Address as Record<string, unknown>), false);
    assert.equal(KCCSO.Status, 'waiting');

    assert.equal(callOf('1', { CFSNumber: '1' }, [0, 1]).event.name, '1');
    assert.equal(callOf('1', { CFSNumber: '1', UseCaution: true }, [0, 1]).event.remarks, 'CFS: 1\nUse Caution');

    assert.throws(() => callOf('1', { CFSNumber: '1', Units: 'garbage' }, [0, 1]));
});

test('unitFeature', () => {
    const now = new Date('2026-10-19T12:00:00Z');

    const feat = unitFeature('E1', {
        UnitID: 'E1',
        UnitName: 'Engine 1',
        UnitStatus: { Description: 'Available' },
        Agency: { Abbreviation: 'BVFD' },
        Latitude: 39.3,
        Longitude: -102.6,
        Speed: 12,
        Heading: '270',
        LocationDateTime: '2026-10-19T11:58:00Z',
        Unexpected: true
    }, [-102.6, 39.3], now);

    assert.equal(feat.id, 'central-square-unit-E1');
    assert.equal(feat.properties.callsign, 'Engine 1');
    assert.equal(feat.properties.type, 'a-f-G-E-V');
    assert.equal(feat.properties.time, '2026-10-19T11:58:00.000Z');
    assert.equal(feat.properties.start, '2026-10-19T11:58:00.000Z');
    assert.equal(feat.properties.stale, '2026-10-19T12:20:00.000Z');
    assert.deepEqual(feat.properties.track, { speed: '12', course: '270' });
    assert.equal(feat.properties.remarks, 'Unit: Engine 1\nStatus: Available\nAgency: BVFD');
    assert.deepEqual(feat.geometry, { type: 'Point', coordinates: [-102.6, 39.3] });
    assert.equal('Unexpected' in (feat.properties.metadata as Record<string, unknown>), false);

    const bare = unitFeature('7', { UniqueIdentifier: 7 }, [0, 1], now);
    assert.equal(bare.properties.callsign, '7');
    assert.equal(bare.properties.time, now.toISOString());
    assert.equal(bare.properties.track, undefined);
    assert.equal(bare.properties.remarks, 'Unit: 7');

    assert.throws(() => unitFeature('7', { UniqueIdentifier: 7, Latitude: 'abc' }, [0, 1], now));
});
