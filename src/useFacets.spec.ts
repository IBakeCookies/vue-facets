import type { Ref } from 'vue';
import { nextTick, shallowRef } from 'vue';
import { describe, expect, it } from 'vitest';
import type { FacetState, UseFacetsConfig } from './index';
import { useFacets } from './index';

interface Item {
    id: string;
    color: Set<string>;
    brand: Set<string>;
    size: Set<string>;
}

type Category = 'color' | 'brand' | 'size';

function item(id: string, color: string[], brand: string[], size: string[]): Item {
    return { id, color: new Set(color), brand: new Set(brand), size: new Set(size) };
}

// 1 red/A/S | 2 blue/B/M | 3 red,green/B/S | 4 green/C/L | 5 blue/A/L
const defaultItems = (): Item[] => [
    item('1', ['red'], ['A'], ['S']),
    item('2', ['blue'], ['B'], ['M']),
    item('3', ['red', 'green'], ['B'], ['S']),
    item('4', ['green'], ['C'], ['L']),
    item('5', ['blue'], ['A'], ['L']),
];

const config: UseFacetsConfig<Item, Category> = {
    facets: [{ category: 'color', label: 'Color', queryKey: 'c' }, { category: 'brand' }, { category: 'size' }],
};

function setup(items: Ref<Item[]> = shallowRef(defaultItems()), overrides: Partial<typeof config> = {}) {
    return useFacets<Item, Category>(items, { ...config, ...overrides });
}

const ids = (list: Item[]) => list.map((i) => i.id);
const names = (facets: Record<string, FacetState>) => Object.keys(facets);
const disabled = (facets: Record<string, FacetState>) =>
    Object.keys(facets).filter((key) => facets[key].isDisabled);

describe('useFacets', () => {
    it('collects every facet value per configured category', () => {
        const { facets, facetCategories } = setup();

        expect(facetCategories.value).toEqual(['color', 'brand', 'size']);
        expect(names(facets.value.color.facets)).toEqual(['red', 'blue', 'green']);
        expect(names(facets.value.brand.facets)).toEqual(['A', 'B', 'C']);
        expect(facets.value.color.label).toBe('Color');
        expect(facets.value.brand.label).toBe('brand');
        expect(facets.value.brand.queryKey).toBe('brand');
    });

    it('returns all items while nothing is active', () => {
        const { filteredItems, count, activeFacetsKeys, query } = setup();

        expect(ids(filteredItems.value)).toEqual(['1', '2', '3', '4', '5']);
        expect(count.value).toBe(5);
        expect(activeFacetsKeys.value).toEqual([]);
        expect(query.value).toBe('');
    });

    it('ORs facets inside one category', () => {
        const { addFacet, filteredItems, activeFacets } = setup();

        addFacet('color', 'red');
        expect(ids(filteredItems.value)).toEqual(['1', '3']);

        addFacet('color', 'blue');
        expect(ids(filteredItems.value)).toEqual(['1', '2', '3', '5']);
        expect(activeFacets.value.color).toEqual(new Set(['red', 'blue']));
    });

    it('ANDs across categories', () => {
        const { addFacet, filteredItems, count } = setup();

        addFacet('color', 'red');
        addFacet('brand', 'B');

        expect(ids(filteredItems.value)).toEqual(['3']);
        expect(count.value).toBe(1);
    });

    it('disables facets that cannot narrow the current result any further', () => {
        const { addFacet, facets } = setup();

        addFacet('color', 'red');

        // red items are 1 (A/S) and 3 (B/S) -> brand C and size M/L are dead ends
        expect(disabled(facets.value.brand.facets)).toEqual(['C']);
        expect(disabled(facets.value.size.facets)).toEqual(['M', 'L']);
        // within an `or` category, options stay clickable when they still yield items
        expect(disabled(facets.value.color.facets)).toEqual([]);
    });

    it('disables values of the active category that conflict with other categories', () => {
        const { addFacet, facets } = setup();

        addFacet('brand', 'C');

        // brand C only has item 4 (green/L)
        expect(disabled(facets.value.color.facets)).toEqual(['red', 'blue']);
        expect(disabled(facets.value.size.facets)).toEqual(['S', 'M']);
    });

    it('re-enables everything once facets are removed', () => {
        const { addFacet, removeFacet, facets, filteredItems } = setup();

        addFacet('color', 'red');
        removeFacet('color', 'red');

        expect(disabled(facets.value.brand.facets)).toEqual([]);
        expect(ids(filteredItems.value)).toHaveLength(5);
    });

    it('toggles and clears', () => {
        const { toggleFacet, removeAllFacets, activeFacetsKeys, count } = setup();

        toggleFacet('color', 'red');
        expect(count.value).toBe(2);

        toggleFacet('color', 'red');
        expect(count.value).toBe(5);

        toggleFacet('color', 'red');
        toggleFacet('brand', 'B');
        removeAllFacets();

        expect(activeFacetsKeys.value).toEqual([]);
        expect(count.value).toBe(5);
    });

    it('ignores unknown facet values', () => {
        const { addFacet, activeFacetsKeys, count } = setup();

        addFacet('color', 'magenta');

        expect(activeFacetsKeys.value).toEqual([]);
        expect(count.value).toBe(5);
    });

    it('counts the selectable facets of a category', () => {
        const { addFacet, getNonDisabledFacetsCategoryLength } = setup();

        expect(getNonDisabledFacetsCategoryLength('brand')).toBe(3);

        addFacet('color', 'red');
        expect(getNonDisabledFacetsCategoryLength('brand')).toBe(2);
    });

    it('rebuilds facets when the items change', async () => {
        const items = shallowRef(defaultItems());
        const { facets, count } = setup(items);

        items.value = [item('9', ['pink'], ['Z'], ['XL'])];
        await nextTick();

        expect(names(facets.value.color.facets)).toEqual(['pink']);
        expect(count.value).toBe(1);
    });

    it('drops selections that the new items no longer offer', async () => {
        const items = shallowRef(defaultItems());
        const { addFacet, activeFacetsKeys, count } = setup(items);

        addFacet('color', 'red');
        addFacet('size', 'S');

        items.value = [item('9', ['pink'], ['Z'], ['S'])];
        await nextTick();

        expect(activeFacetsKeys.value).toEqual(['size']);
        expect(count.value).toBe(1);
    });

    describe('and mode', () => {
        // 1 has both tags, 2 only x, 3 only y
        const tagged = (): Item[] => [
            item('1', ['x', 'y'], ['A'], ['S']),
            item('2', ['x'], ['A'], ['S']),
            item('3', ['y'], ['B'], ['S']),
        ];
        const andSetup = (items = shallowRef(tagged())) =>
            useFacets<Item, Category>(items, {
                facets: [
                    { category: 'color', type: 'and' },
                    { category: 'brand' },
                    { category: 'size' },
                ],
            });

        it('requires an item to have every selected value', () => {
            const { addFacet, filteredItems, facets } = andSetup();

            expect(facets.value.color.type).toBe('and');

            addFacet('color', 'x');
            expect(ids(filteredItems.value)).toEqual(['1', '2']);

            addFacet('color', 'y');
            expect(ids(filteredItems.value)).toEqual(['1']);
        });

        it('disables values that would narrow the result to nothing', () => {
            const { addFacet, facets, getNonDisabledFacetsCategoryLength } = andSetup(
                shallowRef([item('1', ['x'], ['A'], ['S']), item('2', ['y'], ['A'], ['S'])]),
            );

            addFacet('color', 'x');

            // no item has both x and y, so adding y on top is a dead end
            expect(disabled(facets.value.color.facets)).toEqual(['y']);
            expect(getNonDisabledFacetsCategoryLength('color')).toBe(1);
        });

        it('keeps the selected values selectable so they can be removed again', () => {
            const { addFacet, facets } = andSetup();

            addFacet('color', 'x');
            addFacet('color', 'y');

            expect(disabled(facets.value.color.facets)).toEqual([]);
            expect(facets.value.color.facets.x.isActive).toBe(true);
        });

        it('still ANDs with the other categories', () => {
            const { addFacet, filteredItems } = andSetup();

            addFacet('color', 'y');
            addFacet('brand', 'B');

            expect(ids(filteredItems.value)).toEqual(['3']);
        });
    });

    describe('query', () => {
        it('derives a query string using the configured keys', () => {
            const { addFacet, query } = setup();

            addFacet('color', 'red');
            addFacet('color', 'green');
            addFacet('brand', 'B');

            expect(query.value).toBe('c=red&c=green&brand=B');
        });

        it('encodes values instead of relying on separators', () => {
            const items = shallowRef([item('1', ['a,b'], ['A'], ['S'])]);
            const { addFacet, query, applyQuery, activeFacets } = setup(items);

            addFacet('color', 'a,b');
            expect(query.value).toBe('c=a%2Cb');

            applyQuery(query.value);
            expect(activeFacets.value.color).toEqual(new Set(['a,b']));
        });

        it('applies a query string, with or without the leading question mark', () => {
            const { applyQuery, filteredItems, activeFacets } = setup();

            applyQuery('?c=red&c=green&brand=B');

            expect(activeFacets.value.color).toEqual(new Set(['red', 'green']));
            expect(ids(filteredItems.value)).toEqual(['3']);
        });

        it('replaces the previous selection and ignores foreign params', () => {
            const { addFacet, applyQuery, activeFacets, activeFacetsKeys } = setup();

            addFacet('size', 'S');
            applyQuery('c=blue&utm_source=newsletter');

            expect(activeFacetsKeys.value).toEqual(['color']);
            expect(activeFacets.value.color).toEqual(new Set(['blue']));
        });

        it('round trips', () => {
            const { addFacet, query, applyQuery, filteredItems } = setup();

            addFacet('color', 'red');
            addFacet('brand', 'B');

            const shared = query.value;
            const restored = setup();

            restored.applyQuery(shared);

            expect(restored.query.value).toBe(shared);
            expect(ids(restored.filteredItems.value)).toEqual(ids(filteredItems.value));

            applyQuery('');
            expect(query.value).toBe('');
        });

        it('keeps what it can of an impossible combination', () => {
            const { applyQuery, activeFacets, activeFacetsKeys, filteredItems } = setup();

            // no red item has brand C, so the first offending value is dropped, not both
            applyQuery('c=red&brand=C');

            expect(activeFacetsKeys.value).toEqual(['brand']);
            expect(activeFacets.value.brand).toEqual(new Set(['C']));
            expect(ids(filteredItems.value)).toEqual(['4']);
        });

        it('survives a query applied before the items have loaded', async () => {
            const items = shallowRef<Item[]>([]);
            const { applyQuery, activeFacets, filteredItems } = setup(items);

            applyQuery('c=red&c=magenta');
            expect(activeFacets.value.color).toEqual(new Set(['red', 'magenta']));

            items.value = defaultItems();
            await nextTick();

            // the value that turned out not to exist is dropped, the real one survives
            expect(activeFacets.value.color).toEqual(new Set(['red']));
            expect(ids(filteredItems.value)).toEqual(['1', '3']);
        });
    });

    describe('item shapes', () => {
        it('accepts arrays and plain strings', () => {
            interface Mixed {
                id: string;
                color: string[];
                brand: string;
            }

            const items = shallowRef<Mixed[]>([
                { id: '1', color: ['red', 'green'], brand: 'A' },
                { id: '2', color: ['blue'], brand: 'B' },
            ]);

            const { addFacet, filteredItems, facets } = useFacets<Mixed, 'color' | 'brand'>(items, {
                facets: [{ category: 'color' }, { category: 'brand' }],
            });

            expect(names(facets.value.color.facets)).toEqual(['red', 'green', 'blue']);

            addFacet('color', 'green');
            expect(filteredItems.value.map((i) => i.id)).toEqual(['1']);

            addFacet('brand', 'B');
            expect(filteredItems.value).toEqual([]);
        });

        it('accepts any shape through getFacetValues', () => {
            interface Product {
                id: string;
                tags: { name: string }[];
            }

            const items = shallowRef<Product[]>([
                { id: '1', tags: [{ name: 'sale' }, { name: 'new' }] },
                { id: '2', tags: [{ name: 'new' }] },
            ]);

            const { addFacet, filteredItems, facets } = useFacets<Product, 'tag'>(items, {
                facets: [{ category: 'tag' }],
                getFacetValues: (item) => item.tags.map((tag) => tag.name),
            });

            expect(names(facets.value.tag.facets)).toEqual(['sale', 'new']);

            addFacet('tag', 'sale');
            expect(filteredItems.value.map((i) => i.id)).toEqual(['1']);
        });
    });

    it('handles 10k items', () => {
        const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];
        const brands = ['A', 'B', 'C', 'D', 'E', 'F'];
        const sizes = ['S', 'M', 'L', 'XL', 'XXL'];
        let seed = 42;
        const next = (max: number) => {
            seed = (seed * 1103515245 + 12345) % 2147483648;

            return seed % max;
        };
        const items = shallowRef(
            Array.from({ length: 10_000 }, (_, i) =>
                item(String(i), [colors[next(6)]], [brands[next(6)]], [sizes[next(5)]]),
            ),
        );

        const started = performance.now();
        const { addFacet, filteredItems, count, getNonDisabledFacetsCategoryLength } = setup(items);

        addFacet('color', 'red');
        addFacet('brand', 'A');
        addFacet('size', 'S');

        const expected = items.value.filter(
            (i) => i.color.has('red') && i.brand.has('A') && i.size.has('S'),
        );

        expect(count.value).toBe(expected.length);
        expect(ids(filteredItems.value)).toEqual(ids(expected));
        expect(getNonDisabledFacetsCategoryLength('color')).toBeGreaterThan(0);
        expect(performance.now() - started).toBeLessThan(1000);
    });
});
