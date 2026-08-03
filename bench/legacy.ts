// Frozen copy of the implementation this library replaced, kept only so `npm run bench`
// can measure the two against each other. Not part of the package - do not import from src.

import type { Ref, ComputedRef } from 'vue';
import { watch, ref, computed, toValue } from 'vue';

// @todo: remove casting
// @todo: remove any ts-ignore
type Item<I, F extends keyof I> = {
    [K in F]: Set<string>;
};

// currently not used
type ConfigFacetType = 'or' | 'and';

interface ConfigFacet<F> {
    category: F;
    type?: ConfigFacetType;
    label?: string;
    queryKey?: string;
}

interface Config<F> {
    facets: ConfigFacet<F>[];
    withUrlQuery?: boolean;
    isImmediate?: boolean;
}

interface FacetState {
    isActive: boolean;
    isDisabled: boolean;
    type: ConfigFacetType;
}

interface Facet {
    [key: string]: FacetState;
}

type FacetCategory<I, F extends keyof I> = {
    [K in F]: {
        label: string;
        queryKey: string;
        facets: Facet;
    };
};

interface UseFacetsReturn<I, F extends keyof I> {
    addFacet: (category: F, facet: string) => void;
    removeFacet: (category: F, facet: string) => void;
    toggleFacet: (category: F, facet: string) => void;
    removeAllFacets: () => void;
    getNonDisabledFacetsCategoryLength: (category: F) => number;
    facets: Ref<FacetCategory<I, F> | undefined>;
    facetCategories: ComputedRef<F[]>;
    activeFacets: ComputedRef<Record<F, Set<string>> | undefined>;
    activeFacetsKeys: ComputedRef<F[]>;
    filteredItems: ComputedRef<I[]>;
    count: ComputedRef<number>;
}

export function useFacets<I extends Item<I, F>, F extends keyof I & string>(
    items: Readonly<Ref<I[]> | ComputedRef<I[]>>,
    config: Readonly<Config<F>>,
): UseFacetsReturn<I, F> {
    const { facets: configFacets = [], withUrlQuery = true, isImmediate = false } = config;
    const facets: Ref<FacetCategory<I, F> | undefined> = ref();
    const lastFilteredCategory: Ref<F | undefined> = ref<F | undefined>();
    const isServer = false;

    function createFacets(): FacetCategory<I, F> {
        const createdFacets = configFacets.reduce((result, facetConfig) => {
            // @ts-ignore
            result[facetConfig.category] = {
                label: facetConfig.label || facetConfig.category,
                queryKey: facetConfig.queryKey,
                facets: {},
            };

            toValue(items).forEach((item) => {
                const categoryFacets = item[facetConfig.category];

                categoryFacets.forEach((facet) => {
                    if (result[facetConfig.category].facets[facet]) {
                        return;
                    }

                    // @ts-ignore
                    result[facetConfig.category].facets[facet] = {
                        isDisabled: false,
                        isActive: false,
                        type: facetConfig.type || 'and',
                    };
                });
            });

            return result;
        }, {} as FacetCategory<I, F>);

        facets.value = createdFacets;

        return createdFacets;
    }

    const facetCategories: ComputedRef<Set<F>> = computed(() => {
        return configFacets.reduce((result, acc) => {
            result.add(acc.category);

            return result;
        }, new Set<F>());
    });

    const facetCategoriesAsArray: ComputedRef<F[]> = computed(() =>
        Array.from(facetCategories.value),
    );

    const activeFacets: ComputedRef<Record<F, Set<string>> | undefined> = computed(() => {
        if (!facets.value) {
            return;
        }

        const keys: F[] = Object.keys(facets.value) as F[];

        return keys.reduce((result, category) => {
            if (!facets.value) {
                return result;
            }

            const filters = facets.value[category].facets;

            Object.keys(filters).forEach((facet) => {
                const filterValue = filters[facet];

                if (!filterValue) {
                    return;
                }

                if (filterValue.isActive) {
                    result[category] = result[category] || new Set();
                    result[category].add(facet);

                    return;
                }

                if (result[category]) {
                    result[category].delete(facet);
                }
            });

            return result;
        }, {} as Record<F, Set<string>>);
    });

    const activeFacetsKeys: ComputedRef<F[]> = computed(() => {
        if (!activeFacets.value) {
            return [];
        }

        return Object.keys(activeFacets.value) as F[];
    });

    const filteredItems: ComputedRef<I[]> = computed(() => {
        return toValue(items).filter((item) => {
            if (!activeFacets.value) {
                return false;
            }

            for (const activeFacetCategory in activeFacets.value) {
                if (
                    !Array.from(activeFacets.value[activeFacetCategory]).some((facet) => {
                        return item[activeFacetCategory].has(facet);
                    }) ||
                    !activeFacets.value[activeFacetCategory].size
                ) {
                    return false;
                }
            }

            return true;
        });
    });

    const count: ComputedRef<number> = computed(() => {
        return filteredItems.value.length;
    });

    function addFacetWithoutUrlUpdate(inputCategory: F, inputFacet: string): void {
        if (!facets.value) {
            return;
        }

        const facet = facets.value[inputCategory].facets[inputFacet];

        if (!facet) {
            return;
        }

        lastFilteredCategory.value = inputCategory;
        facet.isActive = true;

        updateFacets();
    }

    function addFacet(inputCategory: F, inputFacet: string): void {
        addFacetWithoutUrlUpdate(inputCategory, inputFacet);
        addFacetToUrlQuery(inputCategory, inputFacet);
    }

    function removeFacet(inputCategory: F, inputFacet: string): void {
        if (!facets.value) {
            return;
        }

        const facet = facets.value[inputCategory].facets[inputFacet];

        if (!facet) {
            return;
        }

        lastFilteredCategory.value = inputCategory;
        facet.isActive = false;

        updateFacets();
        removeFacetFromUrlQuery(inputCategory, inputFacet);
    }

    function toggleFacet(inputCategory: F, inputFacet: string): void {
        if (!facets.value) {
            return;
        }

        const facet = facets.value[inputCategory].facets[inputFacet];

        if (!facet) {
            return;
        }

        if (facet.isActive) {
            removeFacet(inputCategory, inputFacet);

            return;
        }

        addFacet(inputCategory, inputFacet);
    }

    function removeAllFacets(): void {
        if (!activeFacets.value) {
            return;
        }

        activeFacetsKeys.value.forEach((category) => {
            if (!facets.value) {
                return;
            }

            Object.keys(facets.value[category].facets).forEach((facet) => {
                if (!facets.value) {
                    return;
                }

                const facetItem = facets.value[category].facets[facet];

                if (!facetItem || !facetItem.isActive) {
                    return;
                }

                removeFacet(category, facet);
            });
        });
    }

    function enableAllFacets(): void {
        if (!facets.value) {
            return;
        }

        for (const category in facets.value) {
            for (const facet in facets.value[category].facets) {
                const facetItem = facets.value[category].facets[facet];

                if (!facetItem) {
                    continue;
                }

                facetItem.isDisabled = false;
            }
        }
    }

    function generateFacetsBasedOnOtherFacets(currentCategory: F): void {
        if (!facets.value) {
            return;
        }

        const otherActiveCategories = facetCategoriesAsArray.value.filter((facetCategory) => {
            const activeCategory =
                activeFacets.value && activeFacets.value[facetCategory]
                    ? activeFacets.value[facetCategory]
                    : new Set();

            return facetCategory !== currentCategory && activeCategory.size;
        });

        const matchingProducts = toValue(items).filter((item) =>
            otherActiveCategories.every((key) => {
                if (!activeFacets.value) {
                    return false;
                }

                return [...activeFacets.value[key]].some((value) => item[key].has(value));
            }),
        );

        Object.keys(facets.value[currentCategory].facets).forEach((facet) => {
            if (!matchingProducts.some((item) => item[currentCategory].has(facet))) {
                if (!facets.value) {
                    return;
                }

                const facetItem = facets.value[currentCategory].facets[facet];

                if (!facetItem) {
                    return;
                }

                facetItem.isDisabled = true;

                if (!facetItem.isActive) {
                    return;
                }

                facetItem.isActive = false;
                removeFacetFromUrlQuery(currentCategory, facet);
            }
        });
    }

    function generateFacetsBasedOnFilteredItems(): void {
        facetCategoriesAsArray.value.forEach((category) => {
            if (!facets.value || (activeFacets.value && activeFacets.value[category]?.size)) {
                return;
            }

            Object.keys(facets.value[category].facets).forEach((facet) => {
                if (!facets.value) {
                    return;
                }

                const hasMatch = filteredItems.value.some((product) =>
                    product[category].has(facet),
                );

                if (hasMatch) {
                    return;
                }

                const facetItem = facets.value[category].facets[facet];

                if (!facetItem) {
                    return;
                }

                facetItem.isDisabled = true;

                if (!facetItem.isActive) {
                    return;
                }

                facetItem.isActive = false;
                removeFacetFromUrlQuery(category, facet);
            });
        });
    }

    function updateFacets(): void {
        enableAllFacets();

        facetCategoriesAsArray.value.forEach((category) => {
            if (
                activeFacets.value &&
                activeFacets.value[category]?.size &&
                lastFilteredCategory.value &&
                category !== lastFilteredCategory.value
            ) {
                generateFacetsBasedOnOtherFacets(category);
            }
        });

        generateFacetsBasedOnFilteredItems();

        // the last filter we click, should be always the last filter we generate because it might disable some other filters, so we need to make sure that all other filters are correctly generated and only then generate the last filter we clicked
        if (!lastFilteredCategory.value) {
            return;
        }

        generateFacetsBasedOnOtherFacets(lastFilteredCategory.value);
    }

    function getUrlParamsAndApplyToFacets(): void {
        if (!withUrlQuery || isServer) {
            return;
        }

        const urlParams = new URLSearchParams(window.location.search);

        urlParams.forEach((value, key) => {
            if (!facets.value) {
                return;
            }

            const keys: F[] = Object.keys(facets.value) as F[];

            const queryKey = keys.find((category) => {
                if (!facets.value) {
                    return;
                }

                return facets.value[category].queryKey === key;
            });

            if (!queryKey) {
                return;
            }

            value.split(',').forEach((facet) => {
                addFacetWithoutUrlUpdate(queryKey as F, facet);
            });
        });
    }

    function addFacetToUrlQuery(category: F & string, facet: string) {
        if (!withUrlQuery || isServer) {
            return;
        }

        const customKey =
            facets.value && facets.value[category].queryKey
                ? facets.value[category].queryKey
                : category;

        const urlParams = new URLSearchParams(window.location.search);

        urlParams.append(customKey, facet);
        window.history.pushState({}, '', `?${urlParams.toString()}`);
    }

    function removeFacetFromUrlQuery(category: F, facet: string): void {
        if (!withUrlQuery || isServer) {
            return;
        }

        const customKey =
            facets.value && facets.value[category].queryKey
                ? facets.value[category].queryKey
                : category;

        const urlParams = new URLSearchParams(window.location.search);
        const entries = urlParams.getAll(customKey).filter((e) => e !== facet);

        urlParams.delete(customKey);
        entries.forEach((entry) => urlParams.append(customKey, entry));
        window.history.pushState({}, '', `?${urlParams.toString()}`);
    }

    function getNonDisabledFacetsCategoryLength(category: F): number {
        if (!facets.value) {
            return 0;
        }

        return Object.keys(facets.value[category].facets).reduce((result, key) => {
            if (!facets.value) {
                return result;
            }

            const facetItem = facets.value[category].facets[key];

            if (!facetItem) {
                return result;
            }

            if (!facetItem.isDisabled) {
                result++;
            }

            return result;
        }, 0);
    }

    if (!isServer) {
        watch(
            items,
            () => {
                createFacets();
                updateFacets();

                if (withUrlQuery) {
                    getUrlParamsAndApplyToFacets();
                }
            },
            {
                immediate: isImmediate,
            },
        );
    }

    return {
        addFacet,
        removeFacet,
        toggleFacet,
        removeAllFacets,
        getNonDisabledFacetsCategoryLength,
        facets,
        facetCategories: facetCategoriesAsArray,
        activeFacets,
        activeFacetsKeys,
        filteredItems,
        count,
    };
}
