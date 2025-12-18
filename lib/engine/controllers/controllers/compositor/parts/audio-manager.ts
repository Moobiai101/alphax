import {generate_id} from "@benev/slate"

import type {Compositor} from "../controller"
import {Actions} from "../../../../state/actions"
// import {collaboration} from "../../../../collaboration-instance"
import {AudioEffect, State} from "../../../../state/types"
import {isEffectMuted} from "../utils/is_effect_muted"
import {Audio} from "../../../../types/media-types"
import {find_place_for_new_effect} from "../../timeline/utils/find_place_for_new_effect"

export class AudioManager extends Map<string, HTMLAudioElement & { objectUrl?: string }> {

	constructor(private compositor: Compositor, private actions: Actions) {super()}

	create_and_add_audio_effect(audio: Audio, state: State) {
		// collaboration.broadcastMedia(audio)
		const duration = audio.element.duration * 1000
		const adjusted_duration_to_timebase = Math.floor(duration / (1000/state.timebase)) * (1000/state.timebase)
		const effect: AudioEffect = {
			id: generate_id(),
			kind: "audio",
			name: audio.file.name,
			file_hash: audio.hash,
			raw_duration: duration,
			duration: adjusted_duration_to_timebase,
			start_at_position: 0,
			start: 0,
			end: adjusted_duration_to_timebase,
			track: 2,
		}
		const {position, track} = find_place_for_new_effect(state.effects, state.tracks)
		effect.start_at_position = position!
		effect.track = track
		this.add_audio_effect(effect, audio.file)
	}

	add_audio_effect(effect: AudioEffect, file: File, recreate?: boolean) {
		if (this.has(effect.id)) {
			this.cleanup_effect(effect.id)
		}
		const audio = document.createElement("audio")
		const source = document.createElement("source")
		const objectUrl = URL.createObjectURL(file)
		source.type = "audio/mp3"
		source.src = objectUrl
		audio.append(source)
		
		const audioEntry = audio as HTMLAudioElement & { objectUrl?: string }
		audioEntry.objectUrl = objectUrl
		this.set(effect.id, audioEntry)
		
		if(recreate) {return}
		this.actions.add_audio_effect(effect)
	}

	cleanup_effect(id: string) {
		const element = this.get(id)
		if(element) {
			element.pause()
			element.src = ""
			if (element.objectUrl) {
				URL.revokeObjectURL(element.objectUrl)
			}
			this.delete(id)
		}
	}

	pause_audios() {
		for(const effect of this.compositor.currently_played_effects.values()) {
			if(effect.kind === "audio") {
				const element = this.get(effect.id)
				if(element)
					element.pause()
			}
		}
	}

	async play_audios() {
		const promises: Promise<void>[] = []
		for(const effect of this.compositor.currently_played_effects.values()) {
			if(effect.kind === "audio") {
				const element = this.get(effect.id)
				if(element) {
					const isMuted = isEffectMuted(effect)
					element.muted = isMuted
					promises.push(element.play().catch(e => console.error(e)))
				}
			}
		}
		await Promise.all(promises)
	}

	pause_audio(effect: AudioEffect) {
		const element = this.get(effect.id)
		if(element)
			element.pause()
	}

	async play_audio(effect: AudioEffect) {
		const element = this.get(effect.id)
		if(element)
			await element.play()
	}
}
