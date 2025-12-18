import {generate_id} from "@benev/slate"

import type {Compositor} from "../controller"
import {Actions} from "../../../../state/actions"
import {omnislate} from "../../../../omnislate"
// import {collaboration} from "../../../../collaboration-instance"
import {VideoEffect, State} from "../../../../state/types"
import {isEffectMuted} from "../utils/is_effect_muted"
import {Video} from "../../../../types/media-types"
import {find_place_for_new_effect} from "../../timeline/utils/find_place_for_new_effect"
import {Sprite as PIXISprite, Container as PIXIContainer, Texture, BaseTexture, VideoResource} from "pixi.js"
import * as PIXI from "pixi.js"
// import {Transformer} from "pixi-transformer"

interface VideoEntry {
	sprite: PIXISprite;
	transformer: PIXIContainer;
	element?: HTMLVideoElement;
	videoResource?: VideoResource;
	objectUrl?: string;
}

export class VideoManager extends Map<string, VideoEntry> {
	#effect_canvas = new Map<string, HTMLCanvasElement>()
	#videoElements = new Map<string, Texture>()

	constructor(private compositor: Compositor, private actions: Actions) {
		super()
	}

	create_and_add_video_effect(video: Video, state: State) {
		// collaboration.broadcastMedia(video)
		const adjusted_duration_to_timebase = Math.floor(video.duration / (1000/state.timebase)) * (1000/state.timebase) - 200
		const effect: VideoEffect = {
			frames: video.frames,
			id: generate_id(),
			name: video.file.name,
			kind: "video",
			file_hash: video.hash,
			raw_duration: video.duration,
			duration: adjusted_duration_to_timebase,
			start_at_position: 0,
			start: 0,
			end: adjusted_duration_to_timebase,
			track: 0,
			thumbnail: video.thumbnail,
			rect: {
				position_on_canvas: {x: this.compositor.app.stage.width / 2, y: this.compositor.app.stage.height / 2},
				width: video.element.videoWidth,
				height: video.element.videoHeight,
				rotation: 0,
				scaleX: 1,
				scaleY: 1,
				pivot: {
					x: video.element.videoWidth / 2,
					y: video.element.videoHeight / 2
				}
			}
		}
		const {position, track} = find_place_for_new_effect(state.effects, state.tracks)
		effect.start_at_position = position!
		effect.track = track
		this.add_video_effect(effect, video.file)
	}

	add_video_effect(effect: VideoEffect, file: File, recreate?: boolean) {
		// Clean up existing effect with same ID if present to prevent leaks
		if (this.has(effect.id)) {
			this.cleanup_effect(effect.id)
		}

		// WebCodecs approach: we don't create a video element anymore
		// Instead we create a blank texture that will be updated by draw_decoded_frame
		
		const canvas = document.createElement("canvas")
		canvas.width = effect.rect.width
		canvas.height = effect.rect.height
		canvas.getContext("2d")!.imageSmoothingEnabled = false
		this.#effect_canvas.set(effect.id, canvas)

		// Create initial texture from black canvas or placeholder
		const texture = Texture.from(canvas)
		this.#videoElements.set(effect.id, texture)
		
		const sprite = new PIXI.Sprite(texture)
		sprite.pivot.set(effect.rect.pivot.x, effect.rect.pivot.y)
		sprite.x = effect.rect.position_on_canvas.x
		sprite.y = effect.rect.position_on_canvas.y
		sprite.scale.set(effect.rect.scaleX, effect.rect.scaleY)
		sprite.rotation = effect.rect.rotation * (Math.PI / 180)
		sprite.width = effect.rect.width
		sprite.height = effect.rect.height
		sprite.eventMode = "static"
		sprite.cursor = "pointer"
		sprite.filters = []
		
		// Dummy transformer for now (transformer functionality is commented out)
		const transformer = new PIXI.Container() as any;

		sprite.on('pointerdown', (e) => {
			// this.compositor.canvasElementDrag.onDragStart(e, sprite, transformer)
			// this.compositor.app.stage.addChild(transformer)
		})
		;(sprite as any).effect = { ...effect }
		//@ts-ignore
		sprite.ignoreAlign = false
		
		// Store video entry without video element/resource since we use Decoder now
		this.set(effect.id, { sprite, transformer })
		
		if(recreate) {return}
		this.actions.add_video_effect(effect)
	}

	cleanup_effect(id: string) {
		const videoEntry = this.get(id)
		if (videoEntry) {
			// Remove from stage if present
			if (videoEntry.sprite.parent) {
				videoEntry.sprite.parent.removeChild(videoEntry.sprite)
			}
			if (videoEntry.transformer.parent) {
				videoEntry.transformer.parent.removeChild(videoEntry.transformer)
			}
			
			// Destroy PIXI resources
			// Destroy texture from map
			const texture = this.#videoElements.get(id)
			if(texture) {
				texture.destroy(true) // Destroys base texture too
				this.#videoElements.delete(id)
			}
			
			if(!videoEntry.sprite.destroyed) {
				videoEntry.sprite.destroy({ children: true, texture: false, baseTexture: false })
			}
			if(!videoEntry.transformer.destroyed) {
				videoEntry.transformer.destroy({ children: true })
			}

			// Clean up video element if it exists (legacy)
			if (videoEntry.element) {
				videoEntry.element.pause()
				videoEntry.element.removeAttribute('src')
				videoEntry.element.load()
			}
			
			if(videoEntry.objectUrl) {
				URL.revokeObjectURL(videoEntry.objectUrl)
			}

			this.delete(id)
			this.#effect_canvas.delete(id)
		}
	}

	add_video_to_canvas(effect: VideoEffect) {
		const video = this.get(effect.id)
		console.log('[VideoManager.add_video_to_canvas] Effect:', effect.id, 'Found:', !!video, 'Sprite:', !!video?.sprite)
		if(video) {
			this.compositor.app.stage.addChild(video.sprite)
			video.sprite.zIndex = omnislate.context.state.tracks.length - effect.track
			video.transformer.zIndex = omnislate.context.state.tracks.length - effect.track
			console.log('[VideoManager.add_video_to_canvas] Added sprite to stage, stage children:', this.compositor.app.stage.children.length)
		}
	}

	remove_video_from_canvas(effect: VideoEffect) {
		const video = this.get(effect.id)
		if(video) {
			this.compositor.app.stage.removeChild(video.sprite)
			this.compositor.app.stage.removeChild(video.transformer)
		}
	}

	//reset element to state before export started
	reset(effect: VideoEffect) {
		const videoEntry = this.get(effect.id)
		if(videoEntry?.sprite) {
			const videoTexture = this.#videoElements.get(effect.id)!
			videoEntry.sprite.texture = videoTexture
			videoEntry.sprite.texture.baseTexture.update()
		}
	}

	draw_decoded_frame(effect: VideoEffect, frame: VideoFrame) {
		const videoEntry = this.get(effect.id)
		if(videoEntry?.sprite) {
			const canvas = this.#effect_canvas.get(effect.id)!
			
			// Resize canvas if needed (if frame size changed)
			if (canvas.width !== videoEntry.sprite.width || canvas.height !== videoEntry.sprite.height) {
				canvas.width = videoEntry.sprite.width
				canvas.height = videoEntry.sprite.height
			}
			
			canvas.getContext("2d")!.drawImage(frame, 0, 0, videoEntry.sprite.width, videoEntry.sprite.height)
			
			// Update the texture from the canvas
			const texture = videoEntry.sprite.texture
			texture.update()
		}
	}

	pause_videos() {
		// Handled by Decoder now
	}

	async play_videos() {
		// Handled by Decoder now
	}

	pause_video(effect: VideoEffect) {
		// Handled by Decoder now
	}

	async play_video(effect: VideoEffect) {
		// Handled by Decoder now
	}

	update_video_textures() {
		// Handled by Decoder via get_and_draw_decoded_frame
	}
}
