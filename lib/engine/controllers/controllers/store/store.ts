import {HistoricalState} from "../../../state/types"
import {json_storage_proxy} from "../../../tools/tools/json_storage_proxy"

export type Store = Partial<HistoricalState>

export function store(storage: Storage) {
	return json_storage_proxy<Store>(storage, "omniclip_")
}
