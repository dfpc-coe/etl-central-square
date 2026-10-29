<h1 align='center'>ETL-CentralSquare</h1>

<p align='center'>Bring CentralSquare Public Safety Suite Professional CAD locations into the TAK System</p>

## Setup

1. Request a Pro Suite API user account from the agency administrator. The agency provides a **Username** and **Password** for
   a dedicated API service account - human user credentials should not be shared with the integration.
2. Ask the agency for the base URL of their Pro Suite deployment:
    - Cloud hosted: `https://{agency-subdomain}.centralsquarecloudgov.com`
    - On-premises: `https://{agency-server}`
3. Confirm with the agency that the account has been granted the `CFS Core - Open` permission (calls for service) and/or the
   `Units - Open` permission (AVL unit tracking), along with the underlying PSJ record permissions for the relevant dispatch agencies.
4. Provide the above information to the ETL CentralSquare Integration.

## Configuration

| Field | Required | Description |
| ----- | -------- | ----------- |
| `BaseURL` | Yes | Base URL of the Pro Suite deployment - ie `https://agency.centralsquarecloudgov.com` |
| `Username` | Yes | Pro Suite API user provisioned by the agency |
| `Password` | Yes | Password for the Pro Suite API user |
| `Domain` | No | Active Directory domain - only required for agencies using LDAP authentication |
| `DataType` | Yes | `Calls for Service` writes currently active CFS incidents to CloudTAK Events with their dispatched units and call taker as Assignments, `Units` posts AVL unit locations to the map |
| `Agencies` | No | Agency codes to submit - ie `BVFD`, `KCCAMB`. A record is kept when its Dispatch Agency, Primary Response Agency or the agency of any assigned unit matches any code. Leave empty to submit every agency the API user can access |
| `BoundingBox` | No | `minLon,minLat,maxLon,maxLat` of acceptable geocoded locations - ie `-105.4,39.5,-104.6,40.0`. Geocoded results outside of the box are discarded |
| `FallbackCoordinates` | No | `Latitude,Longitude` used for records that have no coordinates and could not be geocoded - ie `39.7392,-104.9903` |
| `CommandLog` | No | Append the CAD command log of each call for service to the Event remarks as a table - defaults to `true` |
| `ExpireHours` | No | Hours after the last poll at which a call for service Event ends on its own if the layer stops reporting - default `1` |
| `DEBUG` | No | Print raw API responses in the layer logs |

A single layer handles either calls for service or unit locations. To bring both into TAK, configure two layers against the same
credentials - one with `DataType: Calls for Service` and one with `DataType: Units`.

The task exposes two named Output schemas - `CADEvent` (calls for service, attached to each Event as metadata) and `CADUnit`
(AVL units) - a `Units` layer selects `CADUnit` in the CloudTAK Layer Schema & Styles panels.

### Limitations

- Accounts enforcing multi-factor authentication are not supported - the API service account must be exempt from MFA.
- The `Agencies` filter is applied after the records are fetched - every active record the API user can access is still
  returned by Pro Suite. Scope the API user's permissions at the agency to limit what is returned. Results are not
  filtered by Incident Code.
- Calls for Service are limited to currently active calls.

## How it Works

| Step | Endpoint | Notes |
| ---- | -------- | ----- |
| Authenticate | `POST /api/token` | OAuth 2.0 password grant. Returns a JWT used as a Bearer token |
| Calls for Service | `POST /api/cad/latest/cfs_core/search` | Paginated with `skip`/`limit`, 100 records per page |
| Units | `POST /api/cad/latest/units/search` | Paginated with `skip`/`limit`, 100 records per page |

The Pro Suite token endpoint is aggressively rate limited and authenticating on every call will lock the integration out of API
access. The Bearer token is therefore cached in the layer's ephemeral store and reused until an hour before it expires - the
`expires_in` value returned by Pro Suite is honoured when present, otherwise the documented 24 hour default is assumed.

Every request carries the required `From` header so the agency can attribute API activity to this integration in the Pro Suite
audit trail.

When `Agencies` is configured each record's `DispatchAgency`, `PrimaryResponseAgency` and `Agency` dropdowns are compared,
case insensitively, against the configured codes by their `Code`, `Abbreviation` and `Description` values and a record is
skipped when none of them match. In a consolidated dispatch centre `DispatchAgency` is the centre itself, so the
responding agency is usually found in `PrimaryResponseAgency`. A call is also kept when any unit in its `Units` array belongs
to a configured agency, so a configured fire department assisting on a law enforcement call is still submitted.

Latitude and longitude are read from the record itself (units) or from the nested `GeneralAddress`, `Address` or `Location`
object (calls for service), and both the `Latitude`/`Longitude` and `Lat`/`Lon` spellings are accepted.

Calls for service that carry an address but no coordinates are geocoded via the CloudTAK Search API
(`GET /api/search/suggest` then `GET /api/search/forward`) - this requires the `search:read` permission. When a `BoundingBox`
is configured its centre is used to bias the search and any result outside of the box is rejected. Records that still have no
acceptable coordinates are placed at `FallbackCoordinates` if configured, otherwise they are skipped. Dropdown values - `{ UniqueIdentifier, Description, Code }` - are reduced to their human readable
description for the CoT remarks.

### Calls for Service as Events

Each active call for service becomes a CloudTAK Event, filed under the `central-square` external ID system by its CFS number:

| Event field | Source |
| ----------- | ------ |
| Name | Primary incident description and CFS number - ie `Structure Fire (2026-001234)` |
| Type | MIL-STD-2525E Incident (`10034000001100000000`) |
| Priority | First number of the CAD `Priority` level, code or description - `1` is `critical`, `2` `high`, `3` `medium`, `4` and above `low`, anything else `none` |
| Location | Free form address of the call |
| Started | `CallDateTime`, falling back to `IncidentDateTime` |
| Remarks | Status, priority, cross street, primary response agency, zone, beat, officer, reporter, disposition and caution flag, followed by the CAD command log as a markdown table (time, unit, status, entry, operator call sign) unless `CommandLog` is disabled |
| Metadata | The full `CADEvent` record |
| Ended | `ExpireHours` after the latest poll - the Event ends on its own if this layer stops reporting |
| Channels | Inherited from the Connection the layer belongs to |

The units dispatched to a call are reconciled as Assignments on its Event - one per unit named after the unit, with the unit
status as its role - along with the dispatcher who took the call under the `Call Taker` role. Only Assignments carrying the
`CentralSquare CAD Unit` remark are managed, so people assigned to the Event by users are never modified or removed.

The Event ID, a digest of the last state written and the expiry last set are cached per CFS number in the layer's ephemeral
store. A changed call is updated in place and its expiry pushed out by `ExpireHours`. An unchanged call costs no CloudTAK API
calls until half of that window has elapsed, at which point only its expiry is pushed out again. A call that is no longer
returned as active has its Event ended immediately. When the cache has no record of a call - the first run, or after the store was cleared - the Events
visible to the layer are searched by CFS number before a new Event is created, so an Event is never duplicated.

This ETL is read-only against CentralSquare. It never creates, updates, or deletes records in the agency's CAD system.

### CloudTAK Permissions

| Permission | Required | Purpose |
| ---------- | -------- | ------- |
| `feature:*` | `Units` | Post AVL unit locations to the map |
| `event:create`, `event:read`, `event:update` | `Calls for Service` | Create, look up, update and end the Event of each call for service |
| `assignment:create`, `assignment:read`, `assignment:update`, `assignment:delete` | `Calls for Service` | Keep the units dispatched to a call in step with the Assignments of its Event |
| `search:read` | No | Geocode call for service addresses that have no coordinates |

Writing Events without naming Channels requires a CloudTAK release newer than 13.110.1 - earlier releases reject the Event create request.

## Development

<details><summary>Development Information</summary>

DFPC provided Lambda ETLs are currently all written in [NodeJS](https://nodejs.org/en) through the use of a AWS Lambda optimized
Docker container. Documentation for the Dockerfile can be found in the [AWS Help Center](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html)

```sh
npm install
```

Add a .env file in the root directory that gives the ETL script the necessary variables to communicate with a local ETL server.
When the ETL is deployed the `ETL_API` and `ETL_LAYER` variables will be provided by the Lambda Environment

```json
{
    "ETL_API": "http://localhost:5001",
    "ETL_LAYER": "19"
}
```

To run the task, ensure the local [CloudTAK](https://github.com/dfpc-coe/CloudTAK/) server is running and then run with typescript runtime
or build to JS and run natively with node

```
ts-node task.ts
```

```
npm run build
cp .env dist/
node dist/task.js
```

### Deployment

Deployment into the CloudTAK environment for configuration is done via automatic releases to the DFPC AWS environment.

Github actions will build and push docker releases on every version tag which can then be automatically configured via the
CloudTAK API.

Non-DFPC users will need to setup their own docker => ECS build system via something like Github Actions or AWS Codebuild.

</details>
