import React, { useMemo } from 'react';
import Product from '~/components/elements/products/Product';
import useGetProducCollection from '~/hooks/useGetProducCollection';

const ShopCarouselTopDeal = ({ collectionSlug }) => {
    const { collectionLoading, collectionDetail } =
        useGetProducCollection(collectionSlug);

    const products = useMemo(() => {
        if (!collectionDetail) return [];
        if (collectionLoading) return [];
        return collectionDetail.attributes?.products?.data || [];
    }, [collectionDetail]);

    const content = useMemo(() => {
        if (collectionLoading) {
            return <p>Loading...</p>;
        } else if (products && products.length > 0) {
            return products.map((item) => (
                <div
                    className="col-xl-3 col-lg-4 col-md-4 col-sm-6 col-12 "
                    key={item.id}>
                    <Product product={item} />
                </div>
            ));
        } else {
            return <p>No product found.</p>;
        }
    }, [collectionLoading, products]);

    return (
        <div className="ps-block--container-hightlight">
            <div className="ps-section__header">
                <h3>Top Deals Super Hot Today</h3>s
            </div>
            <div className="ps-section__content">
                <div className="row">{content}</div>
            </div>
        </div>
    );
};

export default ShopCarouselTopDeal;
