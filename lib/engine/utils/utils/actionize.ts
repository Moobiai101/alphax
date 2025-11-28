import {ZipAction} from "@benev/slate/x/watch/zip/action"

import {State, HistoricalState,NonHistoricalState} from "../../state/types"

export const actionize_historical = ZipAction.blueprint<HistoricalState>()
export const actionize_non_historical = ZipAction.blueprint<NonHistoricalState>()
export const actionize = ZipAction.blueprint<State>()
