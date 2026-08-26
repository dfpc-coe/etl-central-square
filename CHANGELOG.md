# CHANGELOG

## Emoji Cheatsheet
- :pencil2: doc updates
- :bug: when fixing a bug
- :rocket: when making general improvements
- :white_check_mark: when adding tests
- :arrow_up: when upgrading dependencies
- :tada: when adding new features

## Version History

### v1.0.0

- :tada: Post CentralSquare Pro Suite Calls for Service locations to the map via `POST /cfs_core/search`
- :tada: Post CentralSquare Pro Suite AVL Unit locations to the map via `POST /units/search`
- :rocket: Cache the OAuth Bearer Token in the layer ephemeral store to respect Pro Suite token rate limits
- :rocket: MVP input surface limited to `BaseURL`, `Username`, `Password`, `Domain`, `DataType` & `DEBUG` - API version, `From` header, active-only filtering, stale time & page limits are fixed constants
- :pencil2: Document agency setup, configuration, limitations, and required Pro Suite permissions
