import React, { Suspense, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useGetProducts from '~/hooks/useGetProducts';
import Product from '~/components/elements/products/Product';

export default function SearchContent() {
    const searchParams = useSearchParams();
    const keyword = searchParams.get('keyword');
    const Router = useRouter();
    const { products, loading, getStrapiProducts } = useGetProducts();

    const searchQuery = useMemo(() => {
        if (keyword.length > 0) {
            return {
                filters: {
                    title: {
                        $contains: keyword,
                    },
                },
                fields: ['id', 'slug', 'title'],
            };
        }
    }, [keyword]);

    useEffect(() => {
        if (searchQuery) {
            getStrapiProducts(searchQuery);
        }
    }, [searchQuery]);

    const productContent = useMemo(() => {
        if (loading) return <p>No product found.</p>;
        if (products.length === 0) return <p>No product found.</p>;
        return (
            <div className="ps-product-items row">
                {products.map((item) => {
                    return (
                        <div className="col-md-3 col-sm-6 col-6" key={item.id}>
                            <Product product={item} />
                        </div>
                    );
                })}
            </div>
        );
    }, [products, loading]);
    return (
        <Suspense>
            <div className="ps-shop ps-shop--search">
                <div className="container">
                    <div className="ps-shop__header">
                        <h1>
                            Search result for: "<strong>{keyword}</strong>"
                        </h1>
                    </div>
                    <div className="ps-shop__content">
                        {products.length > 0 && (
                            <p>
                                <strong style={{ color: '#000' }}>
                                    {products.length}
                                </strong>{' '}
                                record(s) found.
                            </p>
                        )}
                        {productContent}
                    </div>
                </div>
            </div>
        </Suspense>
    );
}
