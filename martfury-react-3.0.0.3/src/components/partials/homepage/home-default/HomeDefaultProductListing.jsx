import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import SkeletonProduct from '~/components/elements/skeletons/SkeletonProduct';
import { generateTempArray } from '~/utilities/common-helpers';
import { ProductGroupWithCarousel } from '~/components/partials/product/ProductGroupWithCarousel';
import useGetProducts from '~/hooks/useGetProducts';
import { DEFAULT_QUERY_GET_PRODUCTS } from '~/services/queries/productStrapiQueries';
import { productCollections } from '~/utilities/product-collections';

const HomeDefaultProductListing = ({ categorySlug, title }) => {
    const [currentType, setCurrentType] = useState(null);
    const { loading, products, getStrapiProducts } = useGetProducts();

    const filteredProducts = useMemo(() => {
        if (loading) return [];
        if (!currentType) return products;
        return products.filter((product) => {
            return product.attributes.type === currentType.value;
        });
    }, [loading, products, currentType]);

    function handleChangeTab(e, tab) {
        e.preventDefault();
        setCurrentType(tab);
    }

    const getProductByCategory = useCallback(
        (categorySlug) => {
            if (categorySlug) {
                const query = {
                    ...DEFAULT_QUERY_GET_PRODUCTS,
                    filters: {
                        product_categories: {
                            slug: {
                                $eq: categorySlug,
                            },
                        },
                    },
                };
                getStrapiProducts(query);
            }
        },
        [getStrapiProducts]
    );

    useEffect(() => {
        getProductByCategory(categorySlug);
    }, [currentType]);

    const sectionLinksView = useMemo(() => {
        return productCollections.map((item) => (
            <li
                className={currentType?.value === item.value ? 'active' : ''}
                key={item.value}>
                <a href="#" onClick={(e) => handleChangeTab(e, item)}>
                    {item.label}
                </a>
            </li>
        ));
    }, [currentType]);

    // DOM Rendering
    const productItemsView = useMemo(() => {
        if (loading) {
            return (
                <div className="row">
                    {generateTempArray(6).map((item) => (
                        <div
                            className="col-xl-2 col-lg-3 col-sm-3 col-6"
                            key={item}>
                            <SkeletonProduct />
                        </div>
                    ))}
                </div>
            );
        } else {
            if (filteredProducts.length === 0) return <p>No product found.</p>;
            else {
                return (
                    <ProductGroupWithCarousel
                        products={filteredProducts}
                        fullwidth
                    />
                );
            }
        }
    }, [loading, filteredProducts]);

    return (
        <div className="ps-product-list">
            <div className="ps-container">
                <div className="ps-section__header">
                    <h3>{title}</h3>
                    <ul className="ps-section__links">
                        {sectionLinksView}
                        <li>
                            <Link href={`/shop`}>View All</Link>
                        </li>
                    </ul>
                </div>
                <div className="ps-section__content">{productItemsView}</div>
            </div>
        </div>
    );
};

export default HomeDefaultProductListing;
