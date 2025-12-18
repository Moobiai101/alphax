console.log("[COMPOSITOR] Module loading started");
import {pub, reactor, signal} from "@benev/slate"
console.log("[COMPOSITOR] @benev/slate imported");

import {Actions} from "../../../state/actions"
console.log("[COMPOSITOR] Actions imported");
import {omnislate} from "../../../omnislate"
console.log("[COMPOSITOR] omnislate imported");
import {Media} from "../media/controller"
console.log("[COMPOSITOR] Media imported");
import {TextManager} from "./parts/text-manager"
console.log("[COMPOSITOR] TextManager imported");
import {ImageManager} from "./parts/image-manager"
console.log("[COMPOSITOR] ImageManager imported");
import {AudioManager} from "./parts/audio-manager"
console.log("[COMPOSITOR] AudioManager imported");
import {VideoManager} from "./parts/video-manager"
console.log("[COMPOSITOR] VideoManager imported");
import {FiltersManager} from "./parts/filter-manager"
console.log("[COMPOSITOR] FiltersManager imported");
import {AlignGuidelines} from "./lib/aligning_guidelines"
console.log("[COMPOSITOR] AlignGuidelines imported");
import {AnimationManager} from "./parts/animation-manager"
console.log("[COMPOSITOR] AnimationManager imported");
import {compare_arrays} from "../../../utils/utils/compare_arrays"
console.log("[COMPOSITOR] compare_arrays imported");
import {TransitionManager} from "./parts/transition-manager"
console.log("[COMPOSITOR] TransitionManager imported");
import {get_effect_at_timestamp} from "../video-export/utils/get_effect_at_timestamp"
console.log("[COMPOSITOR] get_effect_at_timestamp imported");
import {AnyEffect, AudioEffect, ImageEffect, State, TextEffect, VideoEffect} from "../../../state/types"
console.log("[COMPOSITOR] types imported");
import type {
	Sprite as PIXISprite,
	Container as PIXIContainer,
	Rectangle as PIXIRectangle,
	FederatedPointerEvent,
	Application as PIXIApplication
} from "pixi.js"
import * as PIXI from "pixi.js"
console.log("[COMPOSITOR] All imports complete");

export interface Managers {
	videoManager: VideoManager
	textManager: TextManager
	imageManager: ImageManager
	audioManager: AudioManager
	animationManager: AnimationManager
	filtersManager: FiltersManager
	transitionManager: TransitionManager
}

export class Compositor {
	on_playing = pub()
	#is_playing = signal(false)
	#last_time = 0
	#pause_time = 0
	timecode = 0
	timebase = 25
	currently_played_effects = new Map<string, AnyEffect>()

	#app: PIXIApplication | null = null
	#seekedResolve: ((value: unknown) => void) | null = null
	#recreated = false
	#destroyed = false
	#animationFrameId: number | null = null
	
	managers!: Managers
	guidelines!: AlignGuidelines
	#guidelineRect!: PIXISprite

	#pointerDown = false

	// Lazy PIXI.Application initialization for Turbopack compatibility
	get app(): PIXIApplication {
		if (this.#destroyed) {
			console.warn("Accessing destroyed Compositor app");
			// Return a dummy or throw error? Returning null might break types.
			// We'll return the existing (destroyed) app if available, or throw.
			if (this.#app) return this.#app;
			throw new Error('Compositor is destroyed');
		}

		if (!this.#app) {
			if (typeof window === 'undefined') {
				throw new Error('PIXI.Application can only be created in browser environment')
			}
			// Using global PIXI for runtime compatibility with pixi-filters
			this.#app = new PIXI.Application({width: 1920, height: 1080, backgroundColor: "black"})
		}
		return this.#app
	}

	constructor(private actions: Actions) {
		this.#on_selected_canvas_object()
		this.app.stage.sortableChildren = true
		this.app.stage.eventMode = 'static'
		const {guidelines, guidelintRect} = this.init_guidelines()
		this.guidelines = guidelines
		this.#guidelineRect = guidelintRect
		this.app.stage.hitArea = this.app.screen
		this.app.stage.on('pointerup', () => this.canvasElementDrag.onDragEnd())
		this.app.stage.on('pointerupoutside', this.canvasElementDrag.onDragEnd)

		this.managers = {
			videoManager: new VideoManager(this, actions),
			textManager: new TextManager(this, actions),
			imageManager: new ImageManager(this, actions),
			audioManager: new AudioManager(this, actions),
			animationManager: new AnimationManager(this, actions, "Animation"),
			filtersManager: new FiltersManager(this, actions),
			transitionManager: new TransitionManager(this, actions)
		}

		// Don't start the animation frame loop here - wait for markReady() to be called
		// This prevents accessing omnislate.context.state before engine internals are registered
		
		reactor.reaction(
			() => this.#is_playing.value,
			(is_playing) => {
				if(is_playing) {
					this.managers.transitionManager.play(this.timecode)
					this.managers.animationManager.play(this.timecode)
					this.managers.videoManager.play_videos()
					this.managers.audioManager.play_audios()
				} else {
					this.managers.transitionManager.pause()
					this.managers.animationManager.pause()
					this.managers.videoManager.pause_videos()
					this.managers.audioManager.pause_audios()
				}
			}
		)
	}

	#on_playing = () => {
		// Stop the loop if compositor is destroyed
		if (this.#destroyed) {
			return;
		}
		
		if(!this.#is_playing.value) {
			this.#pause_time = performance.now() - this.#last_time
		}
		if(this.#is_playing.value) {
			const elapsed_time = this.#calculate_elapsed_time()
			this.actions.increase_timecode(elapsed_time, {omit: true})
			this.on_playing.publish(0)
			// CRITICAL: Use updated state timecode, NOT this.timecode (which is stale until updated by compose_effects)
			this.compose_effects(omnislate.context.state.effects, omnislate.context.state.timecode)
		}
		this.#animationFrameId = requestAnimationFrame(this.#on_playing)
	}

	canvasElementDrag = {
		onDragStart: (e: FederatedPointerEvent, sprite: PIXIContainer, transformer: PIXIContainer) => {
			if(this.selectedElement) {this.app.stage.removeChild(this.selectedElement?.transformer)}
			this.#pointerDown = true
			let position = e.getLocalPosition(sprite)
			sprite.pivot.set(position.x, position.y)
			sprite.position.set(e.global.x, e.global.y)
			this.app.stage.on('pointermove', (e: FederatedPointerEvent) => this.canvasElementDrag.onDragMove(e))
		},
		onDragEnd: () => {
			if (this.selectedElement) {
				this.app.stage.off('pointermove', this.canvasElementDrag.onDragMove)
				this.#pointerDown = false
			}
		},
		onDragMove: (event: FederatedPointerEvent) => {
			if (this.selectedElement && this.#pointerDown) {
				this.selectedElement?.sprite.parent.toLocal(event.global, undefined, this.selectedElement.sprite.position)
				if(this.guidelines) {
					this.guidelines.on_object_move_or_scale(event)
				}
			}
		}
	}

	reset() {
		omnislate.context.state.effects.forEach((effect: AnyEffect) => {
			if(effect.kind === "text") {
				this.managers.textManager.remove_text_from_canvas(effect)
			} else if(effect.kind === "video") {
				this.managers.videoManager.remove_video_from_canvas(effect)
			} else if(effect.kind === "image") {
				this.managers.imageManager.remove_image_from_canvas(effect)
			}
		})
		this.currently_played_effects.clear()
		this.app.renderer.clear()
	}

	clear(omit?: boolean) {
		if (this.#destroyed || !this.#app || !this.#app.renderer) {
			return;
		}
		this.app.renderer.clear()
		this.app.stage.removeChildren()
		const {guidelines, guidelintRect} = this.init_guidelines()
		this.guidelines = guidelines
		this.#guidelineRect = guidelintRect
		this.managers.animationManager.clearAnimations(omit)
		this.managers.transitionManager.clearTransitions(omit)
		this.actions.set_selected_effect(null)
	}
	
	#calculate_elapsed_time() {
		const now = performance.now() - this.#pause_time
		const elapsed_time = now - this.#last_time
		this.#last_time = now
		return elapsed_time
	}

	compose_effects(effects: AnyEffect[], timecode: number, exporting?: boolean) {
		if(!this.#recreated) {
			// console.log('[Compositor.compose_effects] Skipping - not recreated yet')
			return
		}
		this.timecode = timecode
		this.#update_currently_played_effects(effects, timecode, exporting)
		
		// Update video textures to show current frame
		// This is critical for video playback - PIXI video textures need manual updates
		// when autoPlay is disabled
		this.managers.videoManager.update_video_textures()
		
		// console.log('[Compositor.compose_effects] Rendering at timecode:', timecode, 'currently_played_effects:', this.currently_played_effects.size, 'stage children:', this.app.stage.children.length)
		this.app.render()
	}

	get_effect_current_time_relative_to_timecode(effect: AnyEffect, timecode: number) {
		const current_time = timecode - effect.start_at_position + effect.start
		return current_time / 1000
	}

	get_effects_relative_to_timecode(effects: AnyEffect[], timecode: number) {
		return effects.filter(effect => {
			const transition = this.managers.transitionManager.getTransitionByEffect(effect)
			const {incoming, outgoing} = this.managers.transitionManager.getTransitionDurationPerEffect(transition, effect)
			return effect.start_at_position - incoming <= timecode && timecode <= effect.start_at_position + (effect.end - effect.start) + outgoing
		})
	}

	#update_currently_played_effects(effects: AnyEffect[], timecode: number, exporting?: boolean) {
		const effects_relative_to_timecode = this.get_effects_relative_to_timecode(effects, timecode)
		const {add, remove} = compare_arrays([...this.currently_played_effects.values()], effects_relative_to_timecode)
		this.#update_effects(effects_relative_to_timecode)
		this.#remove_effects_from_canvas(remove, exporting)
		this.#add_effects_to_canvas(add)
		this.#setEffectsIndexes(effects)
		this.app.stage.sortChildren()
	}

	#setEffectsIndexes(effects: AnyEffect[]) {
		effects.filter(e => e.kind !== "audio").forEach(e => {
			const effect = e as ImageEffect | VideoEffect | TextEffect
			const object = this.getObject(effect)
			if(object) {
				object.sprite.zIndex = omnislate.context.state.tracks.length - effect.track
				object.transformer.zIndex = omnislate.context.state.tracks.length - effect.track
			}
		})
	}

	#update_effects(new_effects: AnyEffect[]) {
		this.currently_played_effects.clear()
		new_effects.forEach(effect => {this.currently_played_effects.set(effect.id, effect)})
	}

	async seek(timecode: number, redraw?: boolean) {
		this.managers.animationManager.seek(timecode)
		this.managers.transitionManager.seek(timecode)
		for(const effect of this.currently_played_effects.values()) {
			if(effect.kind === "audio") {
				const audio = this.managers.audioManager.get(effect.id)
				if(!redraw && audio?.paused && this.#is_playing.value) {await audio.play()}
				if(redraw && timecode && audio) {
					const current_time = this.get_effect_current_time_relative_to_timecode(effect, timecode)
					audio.currentTime = current_time
					await this.#onSeeked(audio)
				}
			}
			if(effect.kind === "video") {
				// Use the element directly from VideoEntry
				const videoEntry = this.managers.videoManager.get(effect.id)
				const element = videoEntry?.element
				if(!redraw && element?.paused && this.#is_playing.value) {await element.play()}
				if(redraw && timecode && element) {
					const current_time = this.get_effect_current_time_relative_to_timecode(effect, timecode)
					element.currentTime = current_time
					await this.#onSeeked(element)
				}
			}
		}
	}

	#onSeeked(element: HTMLVideoElement | HTMLAudioElement) {
		const onSeekedEvent = () => {
			if(this.#seekedResolve) {
				element.removeEventListener("seeked", onSeekedEvent)
				this.#seekedResolve(true)
				this.#seekedResolve = null
			}
		}
		onSeekedEvent()
		return new Promise((resolve) => {
			this.#seekedResolve = resolve
			element.addEventListener("seeked", onSeekedEvent, { once: true })
		})
	}

	#add_effects_to_canvas(effects: AnyEffect[]) {
		for(const effect of effects) {
			if(effect.kind === "image") {
				this.currently_played_effects.set(effect.id, effect)
				this.managers.imageManager.add_image_to_canvas(effect)
			}
			else if(effect.kind === "video") {
				this.currently_played_effects.set(effect.id, effect)
				this.managers.videoManager.add_video_to_canvas(effect)
				// Use the element directly from VideoEntry
				const videoEntry = this.managers.videoManager.get(effect.id)
				if(videoEntry?.element) {
					videoEntry.element.currentTime = effect.start / 1000
				}
			}
			else if(effect.kind === "text") {
				this.currently_played_effects.set(effect.id, effect)
				this.managers.textManager.add_text_to_canvas(effect)
			}
			else if(effect.kind === "audio") {
				this.currently_played_effects.set(effect.id, effect)
				const element = this.managers.audioManager.get(effect.id)
				if(element) {element.currentTime = effect.start / 1000}
			}
		}
		this.update_canvas_objects(omnislate.context.state)
	}

	#remove_effects_from_canvas(effects: AnyEffect[], exporting?: boolean) {
		for(const effect of effects) {
			if(effect.kind === "image") {
				this.currently_played_effects.delete(effect.id)
				this.managers.imageManager.remove_image_from_canvas(effect)
			}
			else if(effect.kind === "text") {
				this.currently_played_effects.delete(effect.id)
				this.managers.textManager.remove_text_from_canvas(effect)
			}
			else if(effect.kind === "video") {
				this.currently_played_effects.delete(effect.id)
				this.managers.videoManager.remove_video_from_canvas(effect)
				if(!exporting) {
					this.managers.videoManager.pause_video(effect)
				}
			}
			else if(effect.kind === "audio") {
				this.currently_played_effects.delete(effect.id)
				if(!exporting) {
					this.managers.audioManager.pause_audio(effect)
				}
			}
		}
	}

	getObject(effect: VideoEffect | ImageEffect | TextEffect) {
		const videoObject = this.managers.videoManager.get(effect.id)
		const imageObject = this.managers.imageManager.get(effect.id)
		const textObject = this.managers.textManager.get(effect.id)
		if (videoObject) {
			return videoObject
		} else if (imageObject) {
			return imageObject
		} else if (textObject) {
			return textObject
		}
	}

	init_guidelines() {
		const guidelines = new AlignGuidelines({
			app: this.app,
			compositor: this,
			ignoreObjTypes: [{key: "ignoreAlign", value: true}],
			pickObjTypes: [{key: "ignoreAlign", value: false}]
		})
		// add rect as big as canvas so it acts as guideline for canvas borders
		guidelines.init()
		const guidelintRect = new PIXI.Sprite()
		guidelintRect.width = this.app.view.width
		guidelintRect.height = this.app.view.height
		guidelintRect.eventMode = "none"
		this.app.stage.addChild(guidelintRect)
		return {guidelintRect, guidelines}
	}

	#on_selected_canvas_object() {
		this.app.stage.on("pointerdown", (e: FederatedPointerEvent) => {
			//@ts-ignore
			const selected_effect = e.target ? e.target.effect as AnyEffect : undefined
			const effect = omnislate.context.state.effects.find((eff: AnyEffect) => eff.id === selected_effect?.id)
			omnislate.context.controllers.timeline.set_selected_effect(effect, omnislate.context.state)
		})
		this.app.stage.on("pointerup", (e: FederatedPointerEvent) => {
			const target = e.target as any
			const selected_effect = target?.effect as Exclude<AnyEffect, AudioEffect> | null
			if(selected_effect) {
				this.actions.set_pivot(selected_effect, target.pivot.x, target.pivot.y)
				const {rect: {position_on_canvas: {x, y}}} = selected_effect
				if(x !== e.global.x || y !== e.global.y) {
					const {x: tx, y: ty} = target
					this.actions.set_position_on_canvas(selected_effect, tx, ty);
					this.actions.set_rotation(selected_effect, target.angle)
					this.actions.set_effect_scale(selected_effect, {x: target.scale.x, y: target.scale.y})
					target.effect = {...target.effect,
						rect: {position_on_canvas: {x: tx, y: ty},
						rotation: target.angle,
						scaleX: target.scale.x,
						scaleY: target.scale.y}
					} as Exclude<AnyEffect, AudioEffect>
				}
			}
		})
	}

	async recreate(state: State, media: Media) {
		await media.are_files_ready()
		console.log('[Compositor.recreate] Starting recreate with', state.effects.length, 'effects')
		console.log('[Compositor.recreate] Media controller has', media.size, 'files')
		
		for(const effect of state.effects) {
			if(effect.kind === "image") {
				const mediaEntry = media.get(effect.file_hash)
				console.log('[Compositor.recreate] Image effect', effect.id, 'file_hash:', effect.file_hash, 'found:', !!mediaEntry)
				const file = mediaEntry?.file
				if(file) {
					await this.managers.imageManager.add_image_effect(effect , file, true)
				}
			}
			else if(effect.kind === "video") {
				const mediaEntry = media.get(effect.file_hash)
				console.log('[Compositor.recreate] Video effect', effect.id, 'file_hash:', effect.file_hash, 'found:', !!mediaEntry)
				const file = mediaEntry?.file
				if(file) {
					this.managers.videoManager.add_video_effect(effect, file, true)
					console.log('[Compositor.recreate] Video effect added, VideoManager size:', this.managers.videoManager.size)
				}
			}
			else if(effect.kind === "audio") {
				const file = media.get(effect.file_hash)?.file
				if(file)
					this.managers.audioManager.add_audio_effect(effect, file, true)
			}
			else if(effect.kind === "text") {
				this.managers.textManager.add_text_effect(effect, true)
			}
		}
		for(const filter of state.filters) {
			const effect = state.effects.find(e => e.id === filter.targetEffectId)
			if(effect && (effect.kind === "video" || effect.kind === "image")) {
				this.managers.filtersManager.addFilterToEffect(effect, filter.type, true)
			}
		}
		for(const transition of state.transitions) {
			this.managers.transitionManager.selectTransition(transition, true).apply(omnislate.context.state)
		}
		this.managers.animationManager.refresh(state)
		this.#recreated = true
		console.log('[Compositor.recreate] Recreate complete, calling compose_effects at timecode:', this.timecode)
		this.compose_effects(state.effects, this.timecode)
	}

	update_canvas_objects(state: State) {
		this.app.stage.children.forEach((object: any) => {
			if(object.effect) {
				//@ts-ignore
				const object_effect = object.effect as Exclude<AnyEffect, AudioEffect>
				const effect = state.effects.find(effect => effect.id === object_effect?.id) as Exclude<AnyEffect, AudioEffect>
				if(effect) {
					object.x = effect.rect.position_on_canvas.x
					object.y = effect.rect.position_on_canvas.y
					object.angle = effect.rect.rotation
					object.scale.x = effect.rect.scaleX
					object.scale.y = effect.rect.scaleY
					object.pivot.set(effect.rect.pivot.x, effect.rect.pivot.y)
					this.app.render()
				}
			}
		})
	}

	set_canvas_resolution(width: number, height: number) {
		this.app.renderer.resize(width, height)
		this.#guidelineRect.width = width
		this.#guidelineRect.height = height
		this.managers.transitionManager.refreshTransitions()
	}

	set_timebase(value: number) {
		this.timebase = value
	}

	get selectedElement() {
		const selected = omnislate.context.state.selected_effect
		if(selected?.kind === "video") {
			return this.managers.videoManager.get(selected.id)
		} else if(selected?.kind === "image") {
			return this.managers.imageManager.get(selected.id)
		} else if(selected?.kind === "text") {
			return this.managers.textManager.get(selected.id)
		}
		return null
	}


	setOrDiscardActiveObjectOnCanvas(selectedEffect: AnyEffect | undefined, state: State) {
		if(!selectedEffect) {
			if(this.selectedElement) {
				this.app.stage.removeChild(this.selectedElement?.transformer)
			}
			return
		}
		
		const effect = state.effects.find(e => e.id === selectedEffect.id) ?? selectedEffect // getting again to ensure newest props
		const isEffectOnCanvas = get_effect_at_timestamp(effect, state.timecode)

		if (isEffectOnCanvas) {
			if(this.selectedElement) {
				this.app.stage.addChild(this.selectedElement?.transformer)
			}
		}
	}

	set_video_playing = (playing: boolean) => {
		this.#is_playing.value = playing
		this.actions.set_is_playing(playing, {omit: true})
	}

	toggle_video_playing = () => {
		this.#is_playing.value = !this.#is_playing.value
		this.actions.toggle_is_playing({omit: true})
	}

	/**
	 * Mark compositor as ready for rendering
	 * Called after engine initialization to enable compose_effects
	 * This also starts the animation frame loop for playback
	 */
	markReady() {
		this.#recreated = true
		// Start the animation frame loop now that engine internals are registered
		this.#on_playing()
	}

	/**
	 * Check if compositor is ready for rendering
	 */
	get isReady() {
		return this.#recreated
	}

	get isDestroyed() {
		return this.#destroyed
	}

	/**
	 * Destroy the compositor and clean up resources
	 * Stops the animation frame loop to prevent accessing destroyed state
	 */
	destroy() {
		this.#destroyed = true
		this.#is_playing.value = false
		
		// Cancel the animation frame loop
		if (this.#animationFrameId !== null) {
			cancelAnimationFrame(this.#animationFrameId)
			this.#animationFrameId = null
		}
		
		// Clear currently played effects
		this.currently_played_effects.clear()
		
		// Clear on_playing subscribers by replacing the publisher
		this.on_playing = pub()
		
		// Destroy PIXI app instance
		if (this.#app) {
			try {
				this.#app.destroy(true, {children: true, texture: true, baseTexture: true})
			} catch (e) {
				console.warn("Error destroying PIXI app inside Compositor", e)
			}
			this.#app = null
		}
	}

}
