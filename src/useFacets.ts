import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue';
import { watch, ref, computed, toValue } from 'vue';

/** The values of one facet field on one item. */
export type FacetValues = ReadonlySet<string> | readonly string[] | string;

/**
 * How the values selected inside a single category combine.
 *
 * - `or` (default): an item matches when it has **any** of the selected values
 * - `and`: an item matches only when it has **all** of them
 */
export type FacetType = 'or' | 'and';

/** The shape an item must have when no `getFacetValues` is configured. */
export type FacetItem<I, F extends keyof I> = {
    [K in F]: FacetValues;
};

export interface FacetConfig<F extends string> {
    /** The item field to facet on. */
    category: F;
    /** How selected values combine. Defaults to `or`. */
    type?: FacetType;
    /** Display name. Defaults to the category. */
    label?: string;
    /** Query parameter name used by `query` and `applyQuery`. Defaults to the category. */
    queryKey?: string;
}

export interface UseFacetsConfig<I, F extends string> {
    facets: readonly FacetConfig<F>[];
    /**
     * Read the values of a category off an item. Configure this for item shapes that do not
     * hold their facet values in a `Set`, array or string field named after the category.
     */
    getFacetValues?: (item: I, category: F) => FacetValues | undefined;
}

export interface FacetState {
    isActive: boolean;
    /** Selecting this value would return no items, so it should not be clickable. */
    isDisabled: boolean;
    type: FacetType;
}

export interface FacetCategoryState {
    label: string;
    queryKey: string;
    type: FacetType;
    facets: Record<string, FacetState>;
}

export type Facets<F extends string> = Record<F, FacetCategoryState>;

export interface UseFacetsReturn<I, F extends string> {
    /** Per category: its config plus the state of every value found in the items. */
    facets: ComputedRef<Facets<F>>;
    facetCategories: ComputedRef<F[]>;
    /** The items matching the selection. All of them while nothing is selected. */
    filteredItems: ComputedRef<I[]>;
    count: ComputedRef<number>;
    /** The selected values, only for categories that have any. */
    activeFacets: ComputedRef<Record<F, ReadonlySet<string>>>;
    activeFacetsKeys: ComputedRef<F[]>;
    /** The selection as a query string without a leading `?`, empty when nothing is selected. */
    query: ComputedRef<string>;
    /** Replace the selection with the one encoded in a query string. */
    applyQuery: (query: string) => void;
    addFacet: (category: F, facet: string) => void;
    removeFacet: (category: F, facet: string) => void;
    toggleFacet: (category: F, facet: string) => void;
    removeAllFacets: () => void;
    /** How many values of a category are still selectable. */
    getNonDisabledFacetsCategoryLength: (category: F) => number;
}

type Selection<F extends string> = Partial<Record<F, Set<string>>>;
type ValueSets<F extends string> = Record<F, Set<string>>;

export function useFacets<I extends FacetItem<I, F>, F extends keyof I & string>(
    items: MaybeRefOrGetter<I[]>,
    config: Readonly<UseFacetsConfig<I, F>>,
): UseFacetsReturn<I, F>;
export function useFacets<I, F extends string>(
    items: MaybeRefOrGetter<I[]>,
    config: Readonly<UseFacetsConfig<I, F>> &
        Required<Pick<UseFacetsConfig<I, F>, 'getFacetValues'>>,
): UseFacetsReturn<I, F>;
export function useFacets<I, F extends string>(
    items: MaybeRefOrGetter<I[]>,
    config: Readonly<UseFacetsConfig<I, F>>,
): UseFacetsReturn<I, F> {
    const { facets: configFacets = [], getFacetValues } = config;

    const categories: F[] = [...new Set(configFacets.map(({ category }) => category))];
    const settings = {} as Record<F, { label: string; queryKey: string; type: FacetType }>;

    configFacets.forEach((facetConfig) => {
        settings[facetConfig.category] = {
            label: facetConfig.label || facetConfig.category,
            queryKey: facetConfig.queryKey || facetConfig.category,
            type: facetConfig.type || 'or',
        };
    });

    // aligned with `categories`, so the hot loop below can address everything by index
    const types: FacetType[] = categories.map((category) => settings[category].type);

    const readValues =
        getFacetValues ||
        ((item: I, category: F) => (item as unknown as Record<F, FacetValues>)[category]);

    // the only piece of state: what the user picked. everything else is derived from it
    const active: Ref<Selection<F>> = ref({});

    function hasValue(values: FacetValues | undefined, value: string): boolean {
        if (values === undefined) {
            return false;
        }

        if (typeof values === 'string') {
            return values === value;
        }

        if (Array.isArray(values)) {
            return values.includes(value);
        }

        return (values as ReadonlySet<string>).has(value);
    }

    function eachValue(values: FacetValues | undefined, use: (value: string) => void): void {
        if (values === undefined) {
            return;
        }

        if (typeof values === 'string') {
            use(values);

            return;
        }

        if (Array.isArray(values)) {
            values.forEach(use);

            return;
        }

        (values as ReadonlySet<string>).forEach(use);
    }

    function matches(item: I, category: F, selection: string[], type: FacetType): boolean {
        const values = readValues(item, category);

        if (type === 'and') {
            for (let i = 0; i < selection.length; i++) {
                if (!hasValue(values, selection[i])) {
                    return false;
                }
            }

            return true;
        }

        for (let i = 0; i < selection.length; i++) {
            if (hasValue(values, selection[i])) {
                return true;
            }
        }

        return false;
    }

    function emptyValueSets(): ValueSets<F> {
        return categories.reduce((result, category) => {
            result[category] = new Set<string>();

            return result;
        }, {} as ValueSets<F>);
    }

    // every facet value that exists in the items, per category
    const values: ComputedRef<ValueSets<F>> = computed(() => {
        const result = emptyValueSets();

        toValue(items).forEach((item) => {
            categories.forEach((category) => {
                eachValue(readValues(item, category), (value) => result[category].add(value));
            });
        });

        return result;
    });

    /**
     * A single pass over the items produces both the result list and, per category, the values
     * that are still selectable. For each item, count the active categories it fails to match:
     *
     * - misses none: it is a result, and it keeps every category's values selectable
     * - misses exactly one, and that category is `or`: that category's own selection is the only
     *   thing excluding the item, so widening it would bring the item back - it keeps that one
     *   category's values selectable
     * - misses exactly one `and` category: selecting more there only narrows further, so the item
     *   can never come back - it keeps nothing selectable
     * - misses two or more: it tells us nothing about any single category
     */
    const result: ComputedRef<{ filteredItems: I[]; enabled: ValueSets<F> }> = computed(() => {
        const knownValues = values.value;
        const enabled = emptyValueSets();
        const filteredItems: I[] = [];
        const all = toValue(items);

        const buckets: Set<string>[] = [];
        const totals: number[] = [];
        const activeCategories: F[] = [];
        const activeIndexes: number[] = [];
        const activeTypes: FacetType[] = [];
        const selections: string[][] = [];
        let saturated = 0;

        categories.forEach((category, index) => {
            const selected = active.value[category];

            buckets.push(enabled[category]);
            totals.push(knownValues[category].size);

            if (knownValues[category].size === 0) {
                saturated++;
            }

            if (selected?.size) {
                activeCategories.push(category);
                activeIndexes.push(index);
                activeTypes.push(types[index]);
                // a plain copy: the loop below must not read through a reactive proxy
                selections.push([...selected]);
            }
        });

        // a category can never offer more values than it has, so once its bucket holds all of
        // them there is nothing left to collect and the writes can be skipped entirely
        function collect(item: I, index: number): void {
            const bucket = buckets[index];

            if (bucket.size === totals[index]) {
                return;
            }

            eachValue(readValues(item, categories[index]), (value) => bucket.add(value));

            if (bucket.size === totals[index]) {
                saturated++;
            }
        }

        for (let i = 0; i < all.length; i++) {
            const item = all[i];
            let missedIndex = -1;

            for (let c = 0; c < activeCategories.length; c++) {
                if (matches(item, activeCategories[c], selections[c], activeTypes[c])) {
                    continue;
                }

                if (missedIndex !== -1) {
                    missedIndex = -2;
                    break;
                }

                missedIndex = activeIndexes[c];
            }

            if (missedIndex === -2) {
                continue;
            }

            if (missedIndex !== -1) {
                if (types[missedIndex] === 'or') {
                    collect(item, missedIndex);
                }

                continue;
            }

            filteredItems.push(item);

            if (saturated === categories.length) {
                continue;
            }

            for (let c = 0; c < categories.length; c++) {
                collect(item, c);
            }
        }

        return { filteredItems, enabled };
    });

    const facets: ComputedRef<Facets<F>> = computed(() => {
        const { enabled } = result.value;

        return categories.reduce((acc, category) => {
            const setting = settings[category];
            const categoryFacets: Record<string, FacetState> = {};

            values.value[category].forEach((value) => {
                categoryFacets[value] = {
                    isActive: Boolean(active.value[category]?.has(value)),
                    isDisabled: !enabled[category].has(value),
                    type: setting.type,
                };
            });

            acc[category] = { ...setting, facets: categoryFacets };

            return acc;
        }, {} as Facets<F>);
    });

    const facetCategories: ComputedRef<F[]> = computed(() => categories);

    const activeFacets: ComputedRef<Record<F, ReadonlySet<string>>> = computed(
        () => active.value as Record<F, ReadonlySet<string>>,
    );

    const activeFacetsKeys: ComputedRef<F[]> = computed(() => Object.keys(active.value) as F[]);

    const filteredItems: ComputedRef<I[]> = computed(() => result.value.filteredItems);

    const count: ComputedRef<number> = computed(() => result.value.filteredItems.length);

    const query: ComputedRef<string> = computed(() => {
        const params = new URLSearchParams();

        categories.forEach((category) => {
            active.value[category]?.forEach((facet) =>
                params.append(settings[category].queryKey, facet),
            );
        });

        return params.toString();
    });

    // returns whether the selection actually changed
    function setFacet(category: F, facet: string, isActive: boolean): boolean {
        if (!values.value[category]?.has(facet)) {
            return false;
        }

        const selected = active.value[category];

        if (isActive) {
            if (selected?.has(facet)) {
                return false;
            }

            if (selected) {
                selected.add(facet);
            } else {
                active.value[category] = new Set([facet]);
            }

            return true;
        }

        if (!selected?.delete(facet)) {
            return false;
        }

        if (!selected.size) {
            delete active.value[category];
        }

        return true;
    }

    function addFacet(category: F, facet: string): void {
        setFacet(category, facet, true);
    }

    function removeFacet(category: F, facet: string): void {
        setFacet(category, facet, false);
    }

    function toggleFacet(category: F, facet: string): void {
        setFacet(category, facet, !active.value[category]?.has(facet));
    }

    function removeAllFacets(): void {
        activeFacetsKeys.value.forEach((category) => delete active.value[category]);
    }

    /**
     * Selections can go stale without the user touching anything: the items are replaced, or a
     * query string asks for a combination that yields nothing. Dropping one selected value can
     * revive another, so this runs until it settles - it only ever removes, so it terminates.
     *
     * With no items at all there is nothing to validate against, and clearing the selection would
     * throw away a query string applied before the items arrived.
     */
    function pruneDisabledFacets(): void {
        if (!toValue(items).length) {
            return;
        }

        // one value at a time, re-deriving in between: dropping the first offender can make the
        // next one valid again, so this keeps as much of the selection as is actually reachable
        for (;;) {
            const { enabled } = result.value;
            let hasRemoved = false;

            for (const category of activeFacetsKeys.value) {
                const selected = active.value[category];

                if (!selected) {
                    continue;
                }

                for (const facet of selected) {
                    if (enabled[category]?.has(facet)) {
                        continue;
                    }

                    selected.delete(facet);

                    if (!selected.size) {
                        delete active.value[category];
                    }

                    hasRemoved = true;
                    break;
                }

                if (hasRemoved) {
                    break;
                }
            }

            if (!hasRemoved) {
                return;
            }
        }
    }

    function applyQuery(query: string): void {
        const params = new URLSearchParams(query);
        const selection: Selection<F> = {};

        categories.forEach((category) => {
            const facets = params.getAll(settings[category].queryKey);

            if (facets.length) {
                selection[category] = new Set(facets);
            }
        });

        active.value = selection;
        pruneDisabledFacets();
    }

    function getNonDisabledFacetsCategoryLength(category: F): number {
        return result.value.enabled[category]?.size || 0;
    }

    watch(
        () => toValue(items),
        () => pruneDisabledFacets(),
    );

    return {
        facets,
        facetCategories,
        filteredItems,
        count,
        activeFacets,
        activeFacetsKeys,
        query,
        applyQuery,
        addFacet,
        removeFacet,
        toggleFacet,
        removeAllFacets,
        getNonDisabledFacetsCategoryLength,
    };
}
