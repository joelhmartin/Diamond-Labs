import React, { useEffect, useMemo, useRef } from 'react';
import Slider from 'react-slick';
import { carouselSingle } from '~/utilities/carousel-helpers';
import DealHotProduct from '~/components/elements/products/DealHotProduct';
import HorizontalProduct from '~/components/elements/products/HorizontalProduct';
import useGetProducCollection from '~/hooks/useGetProducCollection';

const ProductGroupDealHot = ({ collectionSlug }) => {
    const sliderRef = useRef(null);
    const { collectionLoading, collectionDetail } =
        useGetProducCollection(collectionSlug);

    const products = useMemo(() => {
        if (!collectionDetail) return [];
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

    const producstContent = useMemo(() => {
        if (collectionLoading) return <p>Loading...</p>;
        else {
            if (products.length === 0) {
                return <p>No product found.</p>;
            } else {
                return (
                    <Slider
                        ref={(slider) => (sliderRef.current = slider)}
                        {...carouselSingle}
                        fade={true}
                        className="ps-carousel">
                        {products.map((item) => (
                            <DealHotProduct product={item} key={item.id} />
                        ))}
                    </Slider>
                );
            }
        }
    }, [collectionLoading, products]);

    const relatedContent = useMemo(() => {
        if (collectionLoading) return <p>Loading...</p>;
        else {
            if (products.length === 0) {
                return <p>No product found.</p>;
            } else {
                const relatedItems = products.map((item, index) => {
                    if (index > 1 && index < 6) {
                        return (
                            <HorizontalProduct product={item} key={item.id} />
                        );
                    }
                });
                return (
                    <Slider {...carouselSingle}>
                        <div className="ps-product-group" key="group-1">
                            {relatedItems}
                        </div>
                    </Slider>
                );
            }
        }
    }, [collectionLoading, products]);

    useEffect(() => {
        if (collectionLoading && products.length > 0) {
            sliderRef.current.slickGoTo(0);
        }
    }, [collectionLoading, products]);

    return (
        <div className="ps-deal-hot">
            <div className="container">
                <div className="row">
                    <div className="col-xl-9 col-lg-12 col-md-12 col-sm-12 col-12">
                        <div className="ps-block--deal-hot" data-mh="dealhot">
                            <div className="ps-block__header">
                                <h3>Deal hot today</h3>
                                <div className="ps-block__navigation">
                                    <a
                                        className="ps-carousel__prev"
                                        href="#"
                                        onClick={(e) => handleCarouselPrev(e)}>
                                        <i className="icon-chevron-left" />
                                    </a>
                                    <a
                                        className="ps-carousel__next"
                                        href="#"
                                        onClick={(e) => handleCarouselNext(e)}>
                                        <i className="icon-chevron-right" />
                                    </a>
                                </div>
                            </div>
                            <div className="ps-product__content">
                                {producstContent}
                            </div>
                        </div>
                    </div>
                    <div className="col-xl-3 col-lg-12 col-md-12 col-sm-12 col-12">
                        <div
                            className="widget widget_best-sale"
                            data-mh="dealhot">
                            <h3 className="widget-title">Top 20 Best Seller</h3>
                            <div className="widget__content">
                                {relatedContent}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProductGroupDealHot;
