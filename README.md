# justCTF 2023 RPG game

This is the source code for the RPG game from the 2023 edition of justCTF.

There are two challenges in this game:
- Trial of Data - analyze the compiled game data in order to complete 5 challenges
- Trial of Bugs - two challenges that require the player to find bugs with the game

## Development - no database

In order to develop this game, you need the following software:
- [Tiled](https://www.mapeditor.org/)
- [Spright](https://github.com/houmain/spright)
- some image editor of your choice

In order to build the game for the first time you need to do these steps:
- build Spright and edit the local_config.json file with the path to the executable (the key in the JSON is `sprightBin`)
- run `yarn install` and `npx tsc`
- `node build/tools/script_builder/builder.js && node build/tools/spritesheet_builder/builder.js && node build/tools/map_builder/builder.js`

Now you can start the game server by running `node build/server/server.js` and the client server using `npx webpack serve`. The game can be played by navigating to http://localhost:8080/

When you make changes to the game files, you need to manually run the *_builder scripts. As such, I usually launch the server by running a command like the following:
```
node build/tools/script_builder/builder.js && node build/tools/spritesheet_builder/builder.js && node build/tools/map_builder/builder.js && node build/server/server.js
```

You can create a deployment package by running `./tools/deploy/create_packages.sh`.

## Development - with database

In order to enable game saving/persistence, you need to start a local postgres instance and edit `local_config.json` appropriately.

The easiest way to start postgres for this game is to build a deployment package and run `docker compose up db` from the `build/packages` directory. Afterwards you need to set `noDatabase` to `false` in local_config.json.

Please note that in order to run the server with a database the session server has to be running as well. It needs to be started before the game server by running `node build/server/player_session_server.js`. Afterwards the game server can be started as normal.
