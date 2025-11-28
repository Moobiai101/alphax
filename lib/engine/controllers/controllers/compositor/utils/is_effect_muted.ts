import {AnyEffect} from "../../../../state/types"
import {omnislate} from "../../../../omnislate"

export function isEffectMuted(effect: AnyEffect) {
	const track = omnislate.context.state.tracks[effect.track]
	return track?.muted ?? false
}
