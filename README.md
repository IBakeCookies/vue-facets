# vue-facets

Faceted filtering composable for Vue 3. Give it a list of items and the fields to facet on, and it
gives you the filtered result plus the state every facet button needs to render.

Its main job is the part that is easy to get wrong: **knowing which facets are dead ends**. A facet
value is disabled when picking it would return zero items, given everything else that is currently
selected — so the UI never lets a user click their way into an empty result.

- `or` and `and` modes per category
- Live `isActive` / `isDisabled` state per value, plus a count of what is still selectable
- A derived query string for shareable urls — the composable never touches `window` itself
- Rebuilds when the items change, dropping selections the new items no longer offer
- Works with `Set`, array or string fields, or any shape via `getFacetValues`
- Fully typed, no dependencies, SSR safe, ~1.7 kB gzipped

```bash
npm install vue-facets
```

Requires `vue >= 3.4` as a peer dependency.

## Quick start

```ts
import type { Ref } from 'vue';
import { shallowRef } from 'vue';
import { useFacets } from 'vue-facets';

interface Item {
    id: string;
    name: string;
    color: Set<string>;
    brand: Set<string>;
}

const items: Ref<Item[]> = shallowRef([
    { id: '1', name: 'Item 1', color: new Set(['red', 'green']), brand: new Set(['A']) },
    { id: '2', name: 'Item 2', color: new Set(['blue']), brand: new Set(['B']) },
]);

const { facets, facetCategories, filteredItems, count, toggleFacet } = useFacets<
    Item,
    'color' | 'brand'
>(items, {
    facets: [
        { category: 'color', label: 'Color', queryKey: 'c' },
        { category: 'brand' },
    ],
});
```

```vue
<div v-for="category in facetCategories" :key="category">
    <span>{{ facets[category].label }}</span>

    <button
        v-for="(state, facet) in facets[category].facets"
        :key="facet"
        :disabled="state.isDisabled"
        :class="{ active: state.isActive }"
        @click="toggleFacet(category, facet)"
    >
        {{ facet }}
    </button>
</div>
```

`items` can be a `ref`, a `computed`, a getter or a plain array. Everything is derived, so there is
no setup step and nothing to call when the items arrive later.

Run `npm run dev` in this repo for a working example, including url syncing and an `and` category.

## or and and

`or` (the default) widens a category: selecting `red` and `blue` returns items that are either.
`and` narrows it: selecting `sale` and `new` returns only items that are both.

```ts
useFacets<Item, 'color' | 'tag'>(items, {
    facets: [
        { category: 'color' },
        { category: 'tag', type: 'and' },
    ],
});
```

The disabled rule follows from the mode. In an `or` category a value is disabled when no item has
it *and* satisfies the other categories. In an `and` category it is disabled when none of the items
you are currently looking at has it, because selecting it can only ever narrow further.

## Urls

The composable does not read or write `window.location` — it exposes the selection as a query
string and takes one back. That keeps it SSR safe and lets you own the history behaviour, whether
that is `history.pushState`, vue-router, or nothing at all.

```ts
const { query, applyQuery } = useFacets(/* ... */);

// restore on load
applyQuery(window.location.search);

// publish on change
watch(query, (value) => {
    window.history.pushState({}, '', value ? `?${value}` : window.location.pathname);
});

// and the back button keeps working
window.addEventListener('popstate', () => applyQuery(window.location.search));
```

With vue-router, `watch(query, (value) => router.push({ query: Object.fromEntries(new URLSearchParams(value)) }))`.

`query` is a plain query string with no leading `?`, empty when nothing is selected. Multiple
values repeat the key (`c=red&c=green`) rather than joining with a separator, so values containing
commas survive the round trip. `applyQuery` **replaces** the whole selection, accepts a leading
`?`, and ignores parameters it does not recognise, so passing a full `location.search` is fine.

Applying a query before the items have loaded keeps the selection as is — once the items arrive,
anything they do not offer is dropped.

## Item shapes

By default each faceted field is read straight off the item and may be a `Set<string>`, a
`string[]` or a single `string`:

```ts
{ id: '1', color: new Set(['red']), size: ['S', 'M'], brand: 'A' }
```

For anything else, read the values yourself. This also frees the category names from having to be
item fields:

```ts
useFacets<Product, 'tag'>(items, {
    facets: [{ category: 'tag' }],
    getFacetValues: (item, category) => item.attributes[category]?.map((a) => a.name),
});
```

## API

`useFacets(items, config)`

| Config option    | Default | Meaning                                                                        |
| ---------------- | ------- | ------------------------------------------------------------------------------ |
| `facets`         | —       | `{ category, type?, label?, queryKey? }[]` — the categories, in order          |
| `getFacetValues` | —       | `(item, category)` returning a `Set`, array, string or `undefined` — see above |

Per facet: `type` defaults to `'or'`, `label` and `queryKey` default to the category name.

| Returns                                    | Type                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `filteredItems`                            | `ComputedRef<I[]>` — all items if nothing is selected                                                                  |
| `count`                                    | `ComputedRef<number>`                                                                                                  |
| `facets`                                   | `ComputedRef<Record<F, FacetCategoryState>>` — `label`, `queryKey`, `type` and every value's `isActive` / `isDisabled` |
| `facetCategories`                          | `ComputedRef<F[]>`                                                                                                     |
| `activeFacets`                             | `ComputedRef<Record<F, ReadonlySet<string>>>` — only categories with a selection                                       |
| `activeFacetsKeys`                         | `ComputedRef<F[]>`                                                                                                     |
| `query`                                    | `ComputedRef<string>`                                                                                                  |
| `applyQuery`                               | `(query: string) => void`                                                                                              |
| `addFacet` / `removeFacet` / `toggleFacet` | `(category, facet) => void` — unknown values are ignored                                                               |
| `removeAllFacets`                          | `() => void`                                                                                                           |
| `getNonDisabledFacetsCategoryLength`       | `(category) => number`                                                                                                 |

## How it works

The only state is what the user selected. `filteredItems` and every facet's `isActive` /
`isDisabled` are derived from it, so there is no mutation cascade to keep in sync.

The whole thing is one pass over the items. For each item, count the *active* categories it fails
to match:

- **misses none** → it is a result, and it keeps every category's values selectable
- **misses exactly one `or` category** → that category's own selection is the only thing excluding
  the item, so widening it would bring the item back — it keeps that one category's values
  selectable
- **misses exactly one `and` category** → selecting more there only narrows further, so the item
  can never come back, and it keeps nothing selectable
- **misses two or more** → it tells us nothing about any single category

That is the whole disabled rule, including the case where a category has nothing selected yet. So
one pass produces the result list *and* the selectable values for every category at once.

## Performance

An earlier version of this composable ran nested scans (`categories × values × items`) several
times per click, because each in-place mutation invalidated the computeds the next loop iteration
read. The current single `O(items × activeCategories)` pass is several times faster — one run of
`npm run bench`, which measures both implementations side by side:

| Items  | Before   | After   |
| ------ | -------- | ------- |
| 1 000  | 28.7 ms  | 8.3 ms  |
| 10 000 | 144.1 ms | 20.1 ms |
| 50 000 | 774.6 ms | 98.5 ms |

40 filter cycles (add two facets, read the results and the facet state, remove them again) over
seeded random data with 4 categories, on node/jsdom. Ratios move between roughly 3x and 8x from run
to run; the 1 000 item case is small enough to be dominated by JIT warm-up.

Where the speed comes from, beyond the algorithm:

- Derived state, so a click recomputes once instead of re-scanning per mutation
- Index-based loops in the hot path — no per-item closures or iterators
- The selection is copied into plain `Set`s so the loop never reads through a Vue proxy
- A category stops collecting values once it already holds all of them
- `getNonDisabledFacetsCategoryLength` is O(1)

At these sizes filtering is no longer the bottleneck — **rendering is**. 50 000 items filter in
~2.5 ms per interaction; painting even 10 000 result nodes costs far more, so reach for virtual
scrolling before optimising this further.

If you do need more, the next step is a bitset index — a `Uint32Array` of item indices per
`(category, value)`, turning a click into word-wise AND/OR plus a popcount. Still linear in the
item count, but with a much smaller constant.

## Not implemented

- Text search, sorting, pagination — bring your own, `filteredItems` is a plain array
- Numeric or date ranges; facet values are strings

## Scripts

| Script               | What it does                            |
| -------------------- | --------------------------------------- |
| `npm run dev`        | the demo app                            |
| `npm test`           | vitest                                  |
| `npm run bench`      | old vs current implementation           |
| `npm run typecheck`  | vue-tsc over src, demo and bench        |
| `npm run build`      | the package (esm, cjs and declarations) |
| `npm run build:demo` | the demo as a static site               |

## License

MIT
