import React, { useMemo } from 'react';
import Link from 'next/link';
import HorizontalProduct from '~/components/elements/products/HorizontalProduct';
import useGetProducCollection from '~/hooks/useGetProducCollection';

const NewArrivals = ({ collectionSlug }) => {
    const { collectionLoading, collectionDetail } =
        useGetProducCollection(collectionSlug);

    const categories = useMemo(() => {
        if (!collectionDetail) return [];
        else {
            return collectionDetail.attributes.product_categories?.data;
        }
    }, [collectionDetail]);

    const products = useMemo(() => {
        if (!collectionDetail) return [];
        return collectionDetail.attributes?.products?.data || [];
    }, [collectionDetail]);

    const filteredProducts = useMemo(() => {
        if (collectionLoading) return [];
        return products;
    }, [products, collectionLoading]);

    // Views
    const productItemView = useMemo(() => {
        if (collectionLoading) return <p>Loading...</p>;
        else {
            if (filteredProducts.length > 0) {
                return filteredProducts.map((item) => (
                    <div
                        className="col-xl-3 col-lg-4 col-md-4 col-sm-6 col-12 "
                        key={item.id}>
                        <HorizontalProduct product={item} />
                    </div>
                ));
            } else {
                return <p>No product found.</p>;
            }
        }
    }, [filteredProducts, collectionLoading]);

    return (
        <div className="ps-product-list ps-new-arrivals">
            <div className="ps-container">
                <div className="ps-section__header">
                    <h3>Hot New Arrivals</h3>
                    <ul className="ps-section__links">
                        {categories?.map((category) => (
                            <li key={category.id}>
                                <Link href={'/shop'}>
                                    {category.attributes.title}
                                </Link>
                            </li>
                        ))}
                        <li>
                            <Link href={'/shop'}>View All</Link>
                        </li>
                    </ul>
                </div>
                <div className="ps-section__content">
                    <div className="row">{productItemView}</div>
                </div>
            </div>
        </div>
    );
};

export default NewArrivals;
