import fs from "fs";
import {PlayerSessionServer} from "./player_session_server_impl";

const localConfig = JSON.parse(fs.readFileSync("local_config.json").toString());

new PlayerSessionServer(localConfig.sessionServer);
