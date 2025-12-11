import React, { useMemo } from 'react';
import Slider from 'react-slick';
import {
    carouselFullwidth,
    carouselStandard,
} from '~/utilities/carousel-helpers';
import Product from '~/components/elements/products/Product';

export const ProductGroupWithCarousel = ({ products, type, fullwidth }) => {
    const isCarousel = useMemo(() => {
        return fullwidth ? products.length >= 7 : products.length >= 5;
    }, [type]);

    const sliderProps = useMemo(
        () => (fullwidth ? carouselFullwidth : carouselStandard),
        [fullwidth]
    );

    const infinite = useMemo(
        () => (fullwidth ? products.length >= 7 : products.length >= 5),
        [fullwidth]
    );

    if (isCarousel) {
        return (
            <Slider
                {...sliderProps}
                infinite={infinite}
                className="ps-carousel outside">
                {products.map((item) => (
                    <div className="ps-carousel-item" key={item.id}>
                        <Product product={item} />
                    </div>
                ))}
            </Slider>
        );
    } else {
        return (
            <div className="row">
                {products.map((item) => (
                    <div
                        className="col-xl-2 col-lg-3 col-sm-3 col-6"
                        key={item.id}>
                        <Product product={item} />
                    </div>
                ))}
            </div>
        );
    }
};
