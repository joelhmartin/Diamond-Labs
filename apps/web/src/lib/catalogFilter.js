/* Which shop products a visitor sees, kept apart from the page so the rules can be tested. */

/* Products for sale that match the search, whatever their category. */
export function searchCatalog(products, query) {
  const q = query.trim().toLowerCase();
  return products.filter((p) => {
    if (!p.active) return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.categories.join(" ").toLowerCase().includes(q) ||
      (p.family?.variants ?? []).some((v) => (v.code ?? "").toLowerCase().includes(q))
    );
  });
}

export function inCategory(products, category) {
  return category ? products.filter((p) => p.categories.includes(category)) : products;
}

/* Every category that has a product for sale, with how many of them match the search.
   A category stays listed at 0 while searching, so the list does not jump as you type. */
export function categoryCounts(products, matches) {
  const names = new Set(products.filter((p) => p.active).flatMap((p) => p.categories));
  return [...names].sort().map((name) => ({
    name,
    count: inCategory(matches, name).length,
  }));
}
