import React, { useMemo } from 'react';
import Slider from 'react-slick';
import {
    carouselFullwidth,
    carouselStandard,
} from '~/utilities/carousel-helpers';
import Product from '~/components/elements/products/Product';
import useGetProducCollection from '~/hooks/useGetProducCollection';

const CustomerBought = ({ collectionSlug, boxed, layout }) => {
    const { collectionLoading, collectionDetail } =
        useGetProducCollection(collectionSlug);

    const products = useMemo(() => {
        if (!collectionDetail) return [];
        return collectionDetail.attributes?.products?.data || [];
    }, [collectionDetail]);

    const productsView = useMemo(() => {
        if (collectionLoading) {
            return <p>Loading...</p>;
        }
        if (products.length === 0) return <p>No product found.</p>;

        const slideItems = products.map((item) => (
            <Product product={item} key={item.id} />
        ));

        return (
            <Slider
                {...(layout !== 'standard'
                    ? carouselFullwidth
                    : carouselStandard)}
                arrows={false}
                className="ps-carousel outside">
                {slideItems}
            </Slider>
        );
    }, [collectionLoading, products, layout]);

    return (
        <div
            className={`ps-section--default ps-customer-bought ${
                boxed === true ? 'boxed' : ''
            }`}>
            <div className="ps-section__header">
                <h3>Customers who bought this item also bought</h3>
            </div>
            <div className="ps-section__content">{productsView}</div>
        </div>
    );
};

export default CustomerBought;
