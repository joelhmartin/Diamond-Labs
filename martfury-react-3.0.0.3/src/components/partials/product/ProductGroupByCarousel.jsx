import React, { useMemo, useRef } from 'react';
import Slider from 'react-slick';
import SkeletonProduct from '~/components/elements/skeletons/SkeletonProduct';
import { generateTempArray } from '~/utilities/common-helpers';
import Product from '~/components/elements/products/Product';
import { carouselStandard } from '~/utilities/carousel-helpers';
import NextArrow from '~/components/elements/carousel/NextArrow';
import PrevArrow from '~/components/elements/carousel/PrevArrow';
import useGetProducCollection from '~/hooks/useGetProducCollection';

const ProductGroupByCarousel = ({
    collectionSlug,
    title,
    layout = 'standard',
}) => {
    const sliderRef = useRef(null);
    const { collectionLoading, collectionDetail } =
        useGetProducCollection(collectionSlug);

    const products = useMemo(() => {
        if (!collectionDetail) return [];
        if (collectionLoading) return [];
        return collectionDetail.attributes?.products?.data || [];
    }, [collectionDetail]);

    const handleCarouselPrev = (e) => {
        e.preventDefault();
        sliderRef.current.slickPrev();
    };

    const handleCarouselNext = (e) => {
        e.preventDefault();
        sliderRef.current.slickNext();
    };

    const carouselFullwidth = {
        dots: false,
        infinite: !!(products && products.length > 7),
        speed: 750,
        slidesToShow: 7,
        slidesToScroll: 3,
        arrows: true,
        nextArrow: <NextArrow />,
        prevArrow: <PrevArrow />,
        lazyload: true,
        responsive: [
            {
                breakpoint: 1750,
                settings: {
                    slidesToShow: 6,
                    slidesToScroll: 3,
                    dots: true,
                    arrows: false,
                },
            },

            {
                breakpoint: 1366,
                settings: {
                    slidesToShow: 5,
                    slidesToScroll: 2,
                    infinite: true,
                    dots: true,
                    arrows: false,
                },
            },
            {
                breakpoint: 1200,
                settings: {
                    slidesToShow: 4,
                    slidesToScroll: 1,
                    infinite: true,
                    dots: true,
                },
            },
            {
                breakpoint: 1024,
                settings: {
                    slidesToShow: 4,
                    slidesToScroll: 1,
                    infinite: true,
                    dots: true,
                },
            },
            {
                breakpoint: 768,
                settings: {
                    slidesToShow: 3,
                    slidesToScroll: 2,
                    dots: true,
                    arrows: false,
                },
            },
            {
                breakpoint: 480,
                settings: {
                    slidesToShow: 2,
                    dots: true,
                    arrows: false,
                },
            },
        ],
    };

    const productsView = useMemo(() => {
        if (collectionLoading) {
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
        } else if (products && products.length > 0) {
            const slideItems = products.map((item) => (
                <Product product={item} key={item.id} />
            ));

            return (
                <Slider
                    ref={(slider) => (sliderRef.current = slider)}
                    {...(layout !== 'standard'
                        ? carouselFullwidth
                        : carouselStandard)}
                    arrows={false}
                    className="ps-carousel outside">
                    {slideItems}
                </Slider>
            );
        } else {
            return <p>No product found.</p>;
        }
    }, [collectionLoading, products, layout]);

    return (
        <div className="ps-block--shop-features">
            <div className="ps-block__header">
                <h3>{title}</h3>
                <div className="ps-block__navigation">
                    <a
                        className="ps-carousel__prev"
                        onClick={(e) => handleCarouselPrev(e)}>
                        <i className="icon-chevron-left" />
                    </a>
                    <a
                        className="ps-carousel__next"
                        onClick={(e) => handleCarouselNext(e)}>
                        <i className="icon-chevron-right" />
                    </a>
                </div>
            </div>
            <div className="ps-block__content">{productsView}</div>
        </div>
    );
};

export default ProductGroupByCarousel;
