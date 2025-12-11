import React, { useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import useGetProducts from '~/hooks/useGetProducts';
import { DEFAULT_QUERY_GET_PRODUCTS } from '~/services/queries/productStrapiQueries';
import { ProductGroupWithCarousel } from '~/components/partials/product/ProductGroupWithCarousel';

const Market2ProductGroupByCategory = ({ categorySlug, title }) => {
    const { loading, products, getStrapiProducts } = useGetProducts();

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
    }, []);

    // Views
    const productItemView = useMemo(() => {
        if (loading) return <p>Loading...</p>;
        else {
            if (products.length > 0) {
                return (
                    <ProductGroupWithCarousel
                        products={products}
                        fullwidth={false}
                    />
                );
            } else {
                return <p>No product found.</p>;
            }
        }
    }, [products, loading]);

    return (
        <section className="ps-product-list">
            <div className="container">
                <div className="ps-section__header">
                    <h3>{title}</h3>
                    <ul className="ps-section__links">
                        <li className="active">
                            <Link href={'/shop'}>New Arrivals</Link>
                        </li>
                        <li>
                            <Link href={'/shop'}>Best seller</Link>
                        </li>
                        <li>
                            <Link href={'/shop'}>Must Popular</Link>
                        </li>
                        <li>
                            <Link href={'/shop'}>View All</Link>
                        </li>
                    </ul>
                </div>
                <div className="ps-section__content">{productItemView}</div>
            </div>
        </section>
    );
};
export default Market2ProductGroupByCategory;
