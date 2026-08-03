import { shallowRef } from 'vue';
import { describe, it } from 'vitest';
import { useFacets } from '../src/useFacets';
import { useFacets as useFacetsOld } from './legacy';

interface Item {
    id: string;
    color: Set<string>;
    brand: Set<string>;
    size: Set<string>;
    category: Set<string>;
}

type Category = 'color' | 'brand' | 'size' | 'category';

const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];
const brands = ['A', 'B', 'C', 'D', 'E', 'F'];
const sizes = ['S', 'M', 'L', 'XL', 'XXL'];
const cats = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF'];

function build(length: number): Item[] {
    let seed = 42;
    const next = (max: number) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;

        return seed % max;
    };

    return Array.from({ length }, (_, i) => ({
        id: String(i),
        color: new Set([colors[next(6)]]),
        brand: new Set([brands[next(6)]]),
        size: new Set([sizes[next(5)]]),
        category: new Set([cats[next(6)]]),
    }));
}

const facetList = [
    { category: 'color' as const },
    { category: 'brand' as const },
    { category: 'size' as const },
    { category: 'category' as const },
];

function cycle(api: any): void {
    void api.facets.value;

    for (let i = 0; i < 20; i++) {
        api.addFacet('color', colors[i % 6]);
        api.addFacet('brand', brands[i % 6]);
        void api.count.value;
        void api.facets.value;
        void api.getNonDisabledFacetsCategoryLength('size');
        api.removeFacet('color', colors[i % 6]);
        api.removeFacet('brand', brands[i % 6]);
        void api.facets.value;
    }
}

function runOld(items: Item[]): number {
    const source = shallowRef(items);
    const started = performance.now();

    cycle(
        useFacetsOld<Item, Category>(source, {
            isImmediate: true,
            withUrlQuery: false,
            facets: facetList,
        }),
    );

    return performance.now() - started;
}

function runNew(items: Item[]): number {
    const source = shallowRef(items);
    const started = performance.now();

    cycle(useFacets<Item, Category>(source, { facets: facetList }));

    return performance.now() - started;
}

describe('benchmark', () => {
    [1_000, 10_000, 50_000].forEach((size) => {
        it(`${size} items`, () => {
            const items = build(size);

            runOld(items.slice(0, 100));
            runNew(items.slice(0, 100));

            const before = runOld(items);
            const after = runNew(items);

            console.log(
                `${size} items: old ${before.toFixed(1)}ms -> new ${after.toFixed(1)}ms (${(before / after).toFixed(1)}x)`,
            );
        });
    });
});
