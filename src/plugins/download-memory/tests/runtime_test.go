package downloadmemory

import (
	"os/exec"
	"testing"

	"github.com/dop251/goja"
)

// Seanime returns these named Go strings directly through Goja, not through JSON.
type localFileType string

type episode struct {
	Type          localFileType `json:"type"`
	AniDBEpisode  string        `json:"aniDBEpisode"`
	EpisodeNumber int           `json:"episodeNumber"`
	IsInvalid     bool          `json:"isInvalid"`
}

type fileMetadata struct {
	Type    localFileType `json:"type"`
	Episode int           `json:"episode"`
}

type localFile struct {
	MediaID  int          `json:"mediaId"`
	Metadata fileMetadata `json:"metadata"`
}

func TestGoBackedEpisodeTypes(t *testing.T) {
	// Transpile the real plugin so both ingestion paths and the veto are exercised.
	payload, err := exec.Command("bun", "-e", `process.stdout.write(new Bun.Transpiler({loader:"ts"}).transformSync(await Bun.file("../main.ts").text()))`).Output()
	if err != nil {
		t.Fatal(err)
	}
	vm := goja.New()
	vm.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))
	vm.Set("files", []localFile{{1, fileMetadata{"main", 1}}, {1, fileMetadata{"special", 2}}})
	vm.Set("episodes", []episode{{"main", "1", 1, false}, {"special", "S1", 2, false}, {"main", "2", 2, true}})
	run := func(source string) {
		t.Helper()
		if _, err := vm.RunString(source); err != nil {
			t.Fatal(err)
		}
	}
	run(`
const memory = new Map(), transient = new Map(), handlers = {}, hooks = {};
const errors = [];
const noop = () => {};
const state = value => ({get: () => value, set: v => {value = v}});
const $storage = {get: k => memory.get(k), set: (k,v) => memory.set(k,v), remove: k => memory.delete(k), keys: () => [...memory.keys()]};
const $store = {get: k => transient.get(k), set: (k,v) => transient.set(k,v), remove: k => transient.delete(k), getAll: () => Object.fromEntries(transient), watch: noop};
const $await = noop;
const console = {log: noop, error: (...v) => errors.push(v.join(' '))};
let modules;
const $shared = {define: (name, factory) => { modules = factory() }, use: () => modules};
const $app = new Proxy({invalidateClientQuery: noop}, {get: (target,key) => target[key] || (fn => {hooks[key] = fn})});
const $database = {localFiles: {getAll: () => files}, autoDownloaderRules: {getAll: () => [{mediaId: 2, comparisonTitle: 'Fixture'}]}};
const $ui = {register: fn => fn({
 newTray: () => ({onOpen: noop, render: noop, updateBadge: noop}),
 state, fieldRef: v => ({current:v, onValueChange:noop, setValue:noop}),
 setTimeout: () => noop, setInterval: () => noop,
 registerEventHandler: (name, fn) => {handlers[name] = fn},
 toast: {info:noop, warning:noop, success:noop, error: (...v) => errors.push(v.join(' '))},
 anime: {
  clearEpisodeCollectionCache: noop,
  getEpisodeCollection: async () => ({hasMappingError: false, episodes}),
  getAnimeMetadata: async () => ({mappings: {anidbId: 123}})
 },
 fetch: async url => ({ok:true, status:200, json: () => url.includes('/AniDB/') ? {IDs:{ID:456}} : {List:[{Size:1,AniDB:{Type:'Episode',EpisodeNumber:1}},{Size:1,AniDB:{Type:'Special',EpisodeNumber:1}},{Size:1,AniDB:{Type:'Episode',EpisodeNumber:2}}]}})
})};
$storage.set('config', {enabled:true,hideFromUi:false,shokoEnabled:true,shokoUrl:'http://fixture',shokoApiKey:'fixture',shokoIntervalMin:15});
`)
	run(string(payload))
	run(`init();`)
	t.Run("library ingestion", func(t *testing.T) {
		v, err := vm.RunString(`modules.ledger.has(1,1) && !modules.ledger.has(1,2)`)
		if err != nil || !v.ToBoolean() {
			t.Fatalf("main episode was not remembered, or special was included: %v %v", v, err)
		}
	})
	run(`handlers['sync-now']();`)
	t.Run("Shoko mapping", func(t *testing.T) {
		v, err := vm.RunString(`modules.ledger.has(2,1) && !modules.ledger.has(2,2)`)
		if err != nil || !v.ToBoolean() {
			summary, _ := vm.RunString(`$storage.get('shoko-last-sync')`)
			t.Fatalf("Shoko did not map the main episode correctly: %v %v; %v", v, err, summary)
		}
	})
	t.Run("duplicate veto", func(t *testing.T) {
		v, err := vm.RunString(`modules.ledger.saveConfig({...modules.ledger.config(),shokoEnabled:false}); let vetoed = false; hooks.onAutoDownloaderBestCandidateSelected({rule:{mediaId:1},episode:1,isSimulation:true,preventDefault:()=>{vetoed=true},next:noop}); vetoed`)
		if err != nil || !v.ToBoolean() {
			t.Fatalf("remembered episode was not vetoed: %v %v", v, err)
		}
	})
	t.Run("unremembered episode remains eligible", func(t *testing.T) {
		v, err := vm.RunString(`vetoed = false; hooks.onAutoDownloaderBestCandidateSelected({rule:{mediaId:1},episode:3,isSimulation:true,preventDefault:()=>{vetoed=true},next:noop}); !vetoed`)
		if err != nil || !v.ToBoolean() {
			t.Fatalf("unremembered episode was vetoed: %v %v", v, err)
		}
	})
}
