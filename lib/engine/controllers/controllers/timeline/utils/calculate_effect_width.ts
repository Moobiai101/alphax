import {AnyEffect} from "../../../../state/types"

export function calculate_effect_width(effect: AnyEffect, zoom: number) {
	return (effect.end - effect.start) * Math.pow(2, zoom) 
}
