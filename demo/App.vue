<script setup lang="ts">
import type { Ref } from 'vue';
import { onUnmounted, shallowRef, watch } from 'vue';
import { useFacets } from '../src';

interface Item {
    id: string;
    name: string;
    color: Set<string>;
    brand: Set<string>;
    size: Set<string>;
    category: Set<string>;
}

const items: Ref<Item[]> = shallowRef([
    {
        id: '1',
        name: 'Item 1',
        color: new Set(['red', 'green']),
        brand: new Set(['A']),
        size: new Set(['S']),
        category: new Set(['AAA']),
    },
    {
        id: '2',
        name: 'Item 2',
        color: new Set(['blue']),
        brand: new Set(['B']),
        size: new Set(['M']),
        category: new Set(['BBB']),
    },
    {
        id: '3',
        name: 'Item 3',
        color: new Set(['yellow', 'red']),
        brand: new Set(['C']),
        size: new Set(['L']),
        category: new Set(['CCC', 'AAA']),
    },
    {
        id: '4',
        name: 'Item 4',
        color: new Set(['yellow']),
        brand: new Set(['D']),
        size: new Set(['XL']),
        category: new Set(['DDD', 'AAA']),
    },
    {
        id: '5',
        name: 'Item 5',
        color: new Set(['purple']),
        brand: new Set(['E']),
        size: new Set(['XXL']),
        category: new Set(['EEE']),
    },
    {
        id: '6',
        name: 'Item 6',
        color: new Set(['orange']),
        brand: new Set(['F']),
        size: new Set(['S']),
        category: new Set(['FFF']),
    },
]);

const {
    count,
    facetCategories,
    facets,
    filteredItems,
    activeFacets,
    activeFacetsKeys,
    toggleFacet,
    removeFacet,
    query,
    applyQuery,
} = useFacets<Item, 'color' | 'brand' | 'size' | 'category'>(items, {
    facets: [
        { category: 'color' },
        { category: 'brand' },
        { category: 'size' },
        // picking two values here requires an item to be in both, instead of either
        { category: 'category', type: 'and' },
    ],
});

// the composable never touches the url itself - the app owns it. swap these lines for
// vue-router (`router.push({ query })`) or drop them if you do not want shareable urls.
applyQuery(window.location.search);

watch(query, (value) => {
    if (value === window.location.search.replace(/^\?/, '')) {
        return;
    }

    window.history.pushState({}, '', value ? `?${value}` : window.location.pathname);
});

const onPopState = () => applyQuery(window.location.search);

window.addEventListener('popstate', onPopState);
onUnmounted(() => window.removeEventListener('popstate', onPopState));
</script>

<template>
    <main class="p-10">
        Active facets:
        <template v-for="category in activeFacetsKeys" :key="category">
            <button
                class="ml-5 bg-gray-200 px-5 py-3 rounded"
                v-for="facet in activeFacets[category]"
                :key="facet"
                @click="removeFacet(category, facet)"
            >
                {{ facet }}
            </button>
        </template>

        <div v-for="category in facetCategories" :key="category" class="mt-5">
            <span class="font-bold block text-xl">
                {{ facets[category].label }}
                <span class="text-sm font-normal text-gray-500">{{ facets[category].type }}</span>
            </span>

            <button
                v-for="(state, facet) in facets[category].facets"
                :key="facet"
                :disabled="state.isDisabled"
                class="px-5 py-3 rounded bg-gray-100 mr-5"
                @click="toggleFacet(category, facet)"
                :class="{
                    'bg-gray-200': state.isActive,
                    'opacity-50': state.isDisabled,
                }"
            >
                {{ facet }}
            </button>
        </div>

        <section class="mt-5">
            <p class="p-2 bg-gray-200 rounded">Items count: {{ count }}</p>

            <div class="grid grid-cols-4 gap-5 mt-5">
                <div
                    class="border bg-gray-100 rounded p-4"
                    v-for="item in filteredItems"
                    :key="item.id"
                >
                    <h3>{{ item.name }}</h3>
                    <p>color: {{ Array.from(item.color).join(', ') }}</p>
                    <p>brand: {{ Array.from(item.brand).join(', ') }}</p>
                    <p>size: {{ Array.from(item.size).join(', ') }}</p>
                    <p>category: {{ Array.from(item.category).join(', ') }}</p>
                </div>
            </div>
        </section>
    </main>
</template>
