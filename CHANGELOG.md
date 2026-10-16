# CHANGELOG

## Emoji Cheatsheet
- :pencil2: doc updates
- :bug: when fixing a bug
- :rocket: when making general improvements
- :white_check_mark: when adding tests
- :arrow_up: when upgrading dependencies
- :tada: when adding new features

## Version History

### Pending Release

### v1.7.0

- :tada: `Calls for Service` are written directly to CloudTAK Events via the `@tak-ps/etl` SDK instead of being submitted as CoT - one Event per CFS number filed under the `central-square` external ID, with the dispatched Units reconciled as Event Assignments and the Event ended once the call is no longer active
- :rocket: CAD `Priority` levels are mapped onto the Event priority scale and the address becomes the Event location
- :rocket: The Event ID & a digest of the last state written are cached in the layer ephemeral store so unchanged calls cost no API calls; the Pro Suite token is merged into the same store
- :tada: Add the `ExpireHours` input (default `1`) - every write sets the Event to end that far out so a call ends on its own if the layer stops reporting; unchanged calls have their expiry pushed out once half the window has elapsed
- :arrow_up: `@tak-ps/etl@^10.24.1`

### v1.6.0

- :arrow_up: Update Core Dependencies

### v1.5.0

- :tada: Add `Agencies` input - an array of Dispatch Agency codes; records whose `DispatchAgency` does not match are discarded before submission

### v1.4.0

- :tada: Expose `CADEvent` & `CADUnit` as named Output schemas via `@tak-ps/etl` Named Schema support - both are returned regardless of `DataType`
- :arrow_up: `@tak-ps/etl@^10.18.0`

### v1.3.0

- :tada: Geocode Calls for Service that have an address but no coordinates via the CloudTAK Search API
- :tada: Add optional `BoundingBox` (`minLon,minLat,maxLon,maxLat`) - geocoded results outside of the box are discarded
- :rocket: Request `event:create`, `event:read`, `event:update` & `search:read` permissions in `capabilities.json`
- :pencil2: Document CloudTAK permissions & geocoding behaviour

### v1.2.0

- :rocket: Build & push via `cloudtak-etl` so `capabilities.json` is annotated onto the OCI manifest

### v1.1.0

- :tada: Add optional `FallbackCoordinates` (`Latitude,Longitude`) used for records without coordinates

### v1.0.0

- :tada: Post CentralSquare Pro Suite Calls for Service locations to the map via `POST /cfs_core/search`
- :tada: Post CentralSquare Pro Suite AVL Unit locations to the map via `POST /units/search`
- :rocket: Cache the OAuth Bearer Token in the layer ephemeral store to respect Pro Suite token rate limits
- :rocket: MVP input surface limited to `BaseURL`, `Username`, `Password`, `Domain`, `DataType` & `DEBUG` - API version, `From` header, active-only filtering, stale time & page limits are fixed constants
- :pencil2: Document agency setup, configuration, limitations, and required Pro Suite permissions
