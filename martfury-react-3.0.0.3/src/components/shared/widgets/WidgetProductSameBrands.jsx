import React, { useMemo } from 'react';
import Product from '~/components/elements/products/Product';
import useGetProducCollection from '~/hooks/useGetProducCollection';

const WidgetProductSameBrands = ({ collectionSlug }) => {
    const { collectionLoading, collectionDetail } =
        useGetProducCollection(collectionSlug);

    const products = useMemo(() => {
        if (!collectionDetail) return [];
        return collectionDetail.attributes?.products?.data || [];
    }, [collectionDetail]);

    // DOM RENDERING
    const productContent = useMemo(() => {
        if (collectionLoading) return <p>loading...</p>;
        if (products.length === 0) return <p>No product found.</p>;
        return products.map((item) => <Product product={item} key={item.id} />);
    }, [collectionLoading, products]);

    return (
        <aside className="widget widget_same-brand">
            <h3>Same Brand</h3>
            <div className="widget__content">{productContent}</div>
        </aside>
    );
};

export default WidgetProductSameBrands;
