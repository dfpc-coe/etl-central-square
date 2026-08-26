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
| `DataType` | Yes | `Calls for Service` posts currently active CFS incident locations, `Units` posts AVL unit locations |
| `DEBUG` | No | Print raw API responses in the layer logs |

A single layer posts either calls for service or unit locations. To bring both into TAK, configure two layers against the same
credentials - one with `DataType: Calls for Service` and one with `DataType: Units`.

### Limitations

- Accounts enforcing multi-factor authentication are not supported - the API service account must be exempt from MFA.
- Results are not filtered by Dispatch Agency or Incident Code - scope the API user's permissions at the agency to limit
  what is returned.
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

Records without usable coordinates are skipped. Latitude and longitude are read from the record itself (units) or from the
nested `GeneralAddress`, `Address` or `Location` object (calls for service), and both the `Latitude`/`Longitude` and `Lat`/`Lon`
spellings are accepted. Dropdown values - `{ UniqueIdentifier, Description, Code }` - are reduced to their human readable
description for the CoT remarks.

This ETL is read-only. It never creates, updates, or deletes records in the agency's CAD system.

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
