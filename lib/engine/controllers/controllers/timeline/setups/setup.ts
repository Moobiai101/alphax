import {WatchTower} from "@benev/slate/x/watch/tower"
import {SignalTower} from "@benev/slate/x/signals/tower"
import {ZipAction} from "@benev/slate/x/watch/zip/action"

import {State} from "../../../../state/types"
import {Timeline} from "../controller"
import {historical_state, non_historical_state} from "../../../../state/state"
import {historical, non_historical} from "../../../../state/actions"
import {historical_actions, non_historical_actions, Actions} from "../../../../state/actions"
import { Compositor } from "../../compositor/controller"
import { Media } from "../../media/controller"

// Use the original blueprints for ZipAction.actualize, then wrap with broadcast
const blueprint_actions = {...non_historical, ...historical}
const state = {...historical_state, ...non_historical_state}

export function setup() {
	const signals = new SignalTower()
	const watch = new WatchTower(signals)
	const timelineTree = watch.stateTree<State>(state)
	const actions_timeline = ZipAction.actualize(timelineTree, blueprint_actions) as Actions
	const media = new Media()
	return {
		timelineTree,
		timelineController: new Timeline(actions_timeline, media, new Compositor(actions_timeline))
	}
}
