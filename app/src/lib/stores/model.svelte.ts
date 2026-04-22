// Reactive shared store for the currently selected chat model.
// Persists in localStorage so the choice survives page navigation + reload.

const STORAGE_KEY = 'lr.selected_model';
const DEFAULT_MODEL = 'glm-5.1:cloud';

interface ModelStore {
	value: string;
}

const _store: ModelStore = $state({
	value:
		typeof localStorage !== 'undefined' ? (localStorage.getItem(STORAGE_KEY) ?? DEFAULT_MODEL) : DEFAULT_MODEL
});

export const modelStore = {
	get value() {
		return _store.value;
	},
	set(name: string) {
		_store.value = name;
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(STORAGE_KEY, name);
		}
	}
};

export { DEFAULT_MODEL };
