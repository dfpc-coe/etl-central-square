import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import CentralSquare, { envelope, PAGE_LIMIT } from '../lib/central-square.js';
import type { Token } from '../lib/central-square.js';

test('envelope', () => {
    assert.deepEqual(envelope({ previous: null, next: null, cfs_cores: [{ CFSNumber: '1' }, 'garbage', null] }, 'cfs_cores'), [{ CFSNumber: '1' }]);

    // Falls back to the first array when the preferred key is absent
    assert.deepEqual(envelope({ next: 'x', results: [{ UnitID: 'E1' }] }, 'units'), [{ UnitID: 'E1' }]);

    // next/previous are never mistaken for the collection
    assert.deepEqual(envelope({ previous: ['nope'], next: ['nope'] }, 'units'), []);
    assert.deepEqual(envelope({}, 'units'), []);
});

type Call = { url: string; method: string; headers: http.IncomingHttpHeaders; body: string };

function serve(handler: (call: Call, res: http.ServerResponse) => void): Promise<http.Server> {
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => body += chunk);
        req.on('end', () => handler({ url: req.url ?? '', method: req.method ?? '', headers: req.headers, body }, res));
    });

    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function origin(server: http.Server): string {
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('CentralSquare - authenticates, follows pagination & caches the token', async () => {
    const calls: Call[] = [];

    const server = await serve((call, res) => {
        calls.push(call);
        res.setHeader('Content-Type', 'application/json');

        if (call.url === '/api/token') {
            return res.end(JSON.stringify({ access_token: 'token-1', expires_in: 7200 }));
        }

        const url = new URL(call.url, 'http://localhost');
        const skip = Number(url.searchParams.get('skip'));

        if (skip === 0) {
            return res.end(JSON.stringify({
                previous: null,
                next: `${url.pathname}?skip=${PAGE_LIMIT}&limit=${PAGE_LIMIT}`,
                cfs_cores: [{ CFSNumber: 'A' }, { CFSNumber: 'B' }]
            }));
        }

        res.end(JSON.stringify({ previous: 'x', next: null, cfs_cores: [{ CFSNumber: 'C' }] }));
    });

    try {
        const tokens: Token[] = [];

        const api = new CentralSquare({
            url: origin(server),
            username: 'api',
            password: 'secret',
            domain: 'AGENCY',
            token: { access_token: 'expired', expires: +new Date() - 1000 },
            onToken: async (token) => {
                tokens.push(token);
            }
        });

        assert.deepEqual(await api.calls(), [{ CFSNumber: 'A' }, { CFSNumber: 'B' }, { CFSNumber: 'C' }]);

        assert.equal(calls[0].url, '/api/token');
        assert.equal(calls[0].headers.from, 'CloudTAK-ETL');
        const grant = new URLSearchParams(calls[0].body);
        assert.equal(grant.get('grant_type'), 'password');
        assert.equal(grant.get('username'), 'api');
        assert.equal(grant.get('domain'), 'AGENCY');
        assert.equal(grant.get('client_id'), 'AGENCY');

        assert.equal(calls[1].url, `/api/cad/latest/cfs_core/search?skip=0&limit=${PAGE_LIMIT}`);
        assert.equal(calls[1].method, 'POST');
        assert.equal(calls[1].headers.authorization, 'Bearer token-1');
        assert.equal(calls[1].headers.from, 'CloudTAK-ETL');
        assert.deepEqual(JSON.parse(calls[1].body), { CurrentlyActive: true });

        assert.equal(calls[2].url, `/api/cad/latest/cfs_core/search?skip=${PAGE_LIMIT}&limit=${PAGE_LIMIT}`);
        assert.equal(calls.length, 3);

        assert.equal(tokens.length, 1);
        assert.equal(tokens[0].access_token, 'token-1');

        // A 2 hour token is refreshed an hour early
        const remaining = tokens[0].expires - +new Date();
        assert.ok(remaining > 59 * 60 * 1000 && remaining <= 60 * 60 * 1000);

        // The issued token is reused
        await api.units();
        assert.equal(tokens.length, 1);
        assert.equal(calls[3].url, `/api/cad/latest/units/search?skip=0&limit=${PAGE_LIMIT}`);
        assert.equal(calls[3].headers.authorization, 'Bearer token-1');
        assert.deepEqual(JSON.parse(calls[3].body), {});
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});

test('CentralSquare - re-authenticates once when a cached token is rejected', async () => {
    const calls: Call[] = [];

    const server = await serve((call, res) => {
        calls.push(call);
        res.setHeader('Content-Type', 'application/json');

        if (call.url === '/api/token') {
            return res.end(JSON.stringify({ access_token: 'fresh' }));
        }

        if (call.headers.authorization !== 'Bearer fresh') {
            res.statusCode = 401;
            return res.end('{}');
        }

        res.end(JSON.stringify({ next: null, units: [{ UnitID: 'E1' }] }));
    });

    try {
        const tokens: Token[] = [];

        const api = new CentralSquare({
            url: origin(server),
            username: 'api',
            password: 'secret',
            token: { access_token: 'revoked', expires: +new Date() + 60 * 60 * 1000 },
            onToken: async (token) => {
                tokens.push(token);
            }
        });

        assert.deepEqual(await api.units(), [{ UnitID: 'E1' }]);

        assert.deepEqual(calls.map((call) => call.url.split('?')[0]), [
            '/api/cad/latest/units/search',
            '/api/token',
            '/api/cad/latest/units/search'
        ]);

        // Undocumented lifetime falls back to 24 hours less the hour margin
        assert.equal(tokens.length, 1);
        const remaining = tokens[0].expires - +new Date();
        assert.ok(remaining > 22 * 60 * 60 * 1000 && remaining <= 23 * 60 * 60 * 1000);
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});

test('CentralSquare - a failed page throws rather than returning a partial snapshot', async () => {
    const server = await serve((call, res) => {
        if (call.url === '/api/token') {
            return res.end(JSON.stringify({ access_token: 'token' }));
        }

        res.statusCode = 500;
        res.end('boom');
    });

    try {
        const api = new CentralSquare({ url: origin(server), username: 'api', password: 'secret' });

        await assert.rejects(api.calls(), /cfs_core\/search Failed: 500 boom/);
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});
