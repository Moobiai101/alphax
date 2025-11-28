import {historical, non_historical} from "./actions"
import {BroadcastOptions} from "../utils/utils/with-broadcast"
import {Filter} from "../controllers/controllers/compositor/parts/filter-manager"
import {Animation} from "../controllers/controllers/compositor/parts/animation-manager"
import {Transition} from "../controllers/controllers/compositor/parts/transition-manager"
import type {
	ColorSource,
	TextStyleAlign,
	TextStyleFontStyle,
	TextStyleFontVariant,
	TextStyleFontWeight,
	TextStyleTextBaseline,
	TextStyleWhiteSpace,
	TextStyleLineJoin,
	TextStyleFill
} from "pixi.js"
import {TEXT_GRADIENT} from "pixi.js"

// Re-export for compatibility with code expecting these names
export type LineJoin = TextStyleLineJoin
export type StrokeInput = TextStyleFill
export type FillInput = TextStyleFill
export {TEXT_GRADIENT}
// export interface OmniStateHistorical {
// 	timeline: HistoricalState
// }

// export interface OmniStateNonHistorical {
// 	timeline: NonHistoricalState
// }

// export type OmniState = OmniStateHistorical & OmniStateNonHistorical

export type State = HistoricalState & NonHistoricalState

export type V2 = [number, number]
export type ExportStatus = "complete" | "composing" | "demuxing" | "flushing" | "error"

export interface HistoricalState {
	projectName: string
	projectId: string
	effects: AnyEffect[]
	tracks: XTrack[]
	filters: Filter[]
	animations: Animation[]
	transitions: Transition[]
}

export interface NonHistoricalState {
	selected_effect: AnyEffect | null
	is_playing: boolean
	is_exporting: boolean
	export_progress: number
	export_status: ExportStatus
	fps: number
	timecode: number
	length: number
	zoom: number
	timebase: number
	log: string
	settings: Settings
}

// export type XTimeline = NonHistoricalState & HistoricalState

export interface Effect {
	id: string
	start_at_position: number
	duration: number
	start: number
	end: number
	track: number
}

export interface VideoEffect extends Effect {
	kind: "video"
	thumbnail: string
	raw_duration: number
	frames: number
	rect: EffectRect
	file_hash: string
	name: string
}

export interface AudioEffect extends Effect {
	kind: "audio"
	raw_duration: number
	file_hash: string
	name: string
}

export interface ImageEffect extends Effect {
	kind: "image"
	rect: EffectRect
	file_hash: string
	name: string
}

export type TextEffectProps = Omit<TextEffect, keyof Effect | "kind">
export type Font = string

export interface EffectRect {
	width: number
	height: number
	scaleX: number
	scaleY: number
	position_on_canvas: {
		x: number
		y: number
	}
	rotation: number
	pivot: {
		x: number
		y: number
	}
}

export interface TextEffect extends Effect {
	kind: "text"
	fontFamily: Font
	text: string
	fontSize: number
	fontStyle: TextStyleFontStyle
	align: TextStyleAlign
	fontVariant: TextStyleFontVariant
	fontWeight: TextStyleFontWeight
	fill: FillInput[]
	fillGradientType: TEXT_GRADIENT
	fillGradientStops: number[]
	rect: EffectRect
	stroke: StrokeInput
	strokeThickness: number
	lineJoin: LineJoin
	miterLimit: number
	letterSpacing: number
	dropShadow: boolean
	dropShadowAlpha: number
	dropShadowAngle: number
	dropShadowBlur: number
	dropShadowDistance: number
	dropShadowColor: ColorSource
	wordWrap: boolean
	wordWrapWidth: number
	lineHeight: number
	leading: number
	breakWords: boolean
	whiteSpace: TextStyleWhiteSpace
	textBaseline: TextStyleTextBaseline
}

export type AnyEffect = (
	| VideoEffect
	| AudioEffect
	| TextEffect
	| ImageEffect
)

export type Timeline = {
  effects: AnyEffect[]
}

export interface Timecode {
	milliseconds: number
	seconds: number
	minutes: number
	hours: number
}

export interface EffectTimecode {
	timeline_start: number
	timeline_end: number
	track: number
}

export interface At {
	coordinates: V2
	indicator: Indicator
}

export interface XTrack {
	id: string
	locked: boolean
	visible: boolean
	muted: boolean
}

export interface Grabbed {
	effect: AnyEffect
	offset: {
		x: number
		y: number
	}
}

export interface ProposedTimecode {
	proposed_place: {
		start_at_position: number
		track: number
	}
	duration: number | null
	effects_to_push: AnyEffect[] | null
}

export type AspectRatio = "16/9" | "1/1" | "4/3" | "9/16" | "3/2" | "21/9"
export type Standard = "4k" | "2k" | "1080p" | "720p" | "480p"

export type Settings = {
	width: number
	height: number
	bitrate: number
	aspectRatio: AspectRatio
	standard: Standard
}

export type Indicator = AddTrackIndicator | null
export interface AddTrackIndicator {
	index: number
	type: "addTrack"
}
export type Status = "render" | "decode" | "demux" | "fetch"

// Utility type to adjust action types for broadcasting
// The actions from ZipAction.Callable are already flattened to (...params: P) => void
// We need to add BroadcastOptions as an optional last argument
type WithBroadcast<T> = T extends (...args: infer P) => infer R
	? P extends []
		? (options?: BroadcastOptions) => R
		: (...args: [...P, BroadcastOptions?]) => R
	: never

// Apply WithBroadcast to all actions (using the Callable types from ZipAction)
type HistoricalCallable = import("@benev/slate/x/watch/zip/action").ZipAction.Callable<typeof historical>
type NonHistoricalCallable = import("@benev/slate/x/watch/zip/action").ZipAction.Callable<typeof non_historical>

export type HistoricalActionsWithBroadcast = {
	[K in keyof HistoricalCallable]: WithBroadcast<HistoricalCallable[K]>
}

export type NonHistoricalActionsWithBroadcast = {
	[K in keyof NonHistoricalCallable]: WithBroadcast<NonHistoricalCallable[K]>
}
