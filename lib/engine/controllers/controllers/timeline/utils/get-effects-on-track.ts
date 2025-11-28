import {AnyEffect, State} from "../../../types"

export function getEffectsOnTrack(state: State, trackId: number): AnyEffect[] {
	return state.effects.filter(effect => effect.track === trackId)
}
