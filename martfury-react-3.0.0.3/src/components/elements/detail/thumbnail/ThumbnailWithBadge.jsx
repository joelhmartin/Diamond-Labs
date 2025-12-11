import React, { useEffect, useMemo, useRef, useState } from 'react';
import Slider from 'react-slick';
import NextArrow from '~/components/elements/carousel/NextArrow';
import PrevArrow from '~/components/elements/carousel/PrevArrow';
import { getStrapiImageURL } from '~/services/strapiServices/image/getStrapiImageService';

const ThumbnailWithBadge = ({ product, vertical = true }) => {
    const galleryCarousel = useRef(null);
    const variantCarousel = useRef(null);
    const [gallery, setGallery] = useState(null);
    const [variant, setVariant] = useState(null);

    const images = useMemo(() => {
        if (product.attributes.images.data?.length > 0) {
            return product.attributes.images.data.map((image) => {
                return getStrapiImageURL(image, 'large', true);
            });
        } else {
            return [];
        }
    }, [product]);

    useEffect(() => {
        setGallery(galleryCarousel.current);
        setVariant(variantCarousel.current);
    }, [product]);

    const gallerySetting = {
        dots: false,
        infinite: true,
        speed: 500,
        slidesToShow: 1,
        slidesToScroll: 1,
        nextArrow: <NextArrow />,
        prevArrow: <PrevArrow />,
    };
    const variantSetting = {
        responsive: [
            {
                breakpoint: 1024,
                settings: {
                    slidesToShow: 4,
                    dots: false,
                    arrows: false,
                    vertical: false,
                    infinite: false,
                },
            },
            {
                breakpoint: 768,
                settings: {
                    slidesToShow: 4,
                    dots: false,
                    arrows: false,
                    vertical: false,
                    infinite: false,
                },
            },
            {
                breakpoint: 480,
                settings: {
                    slidesToShow: 4,
                    dots: false,
                    arrows: false,
                    vertical: false,
                    infinite: false,
                },
            },
        ],
    };

    //Views
    const imagesView = useMemo(() => {
        return images.length > 0
            ? images.map((item) => (
                  <div className="item" key={item}>
                      <img src={item} alt={item} />
                  </div>
              ))
            : null;
    }, [images]);

    const galleryImagesView = useMemo(() => {
        return images.length > 0
            ? images.map((item, index) => (
                  <div className="item" key={item}>
                      <a href="#" onClick={(e) => e.preventDefault()}>
                          <img src={item} alt={item} />
                      </a>
                  </div>
              ))
            : null;
    }, [images]);

    const variantCarouselView = useMemo(() => {
        return vertical ? (
            <Slider
                asNavFor={gallery}
                ref={(slider) => (variantCarousel.current = slider)}
                swipeToSlide={true}
                arrows={false}
                slidesToShow={3}
                vertical={true}
                infinite={true}
                focusOnSelect={true}
                {...variantSetting}
                className="ps-product__variants">
                {imagesView}
            </Slider>
        ) : (
            <Slider
                asNavFor={gallery}
                ref={(slider) => (variantCarousel.current = slider)}
                swipeToSlide={true}
                arrows={false}
                slidesToShow={6}
                vertical={false}
                centered={true}
                infinite={false}
                focusOnSelect={true}
                className="ps-product__variants">
                {imagesView}
            </Slider>
        );
    }, [vertical, gallery, variantSetting, imagesView]);

    return (
        <div
            className="ps-product__thumbnail"
            data-vertical={vertical ? 'true' : 'false'}>
            <figure>
                <div className="ps-wrapper">
                    <Slider
                        {...gallerySetting}
                        ref={(slider) => (galleryCarousel.current = slider)}
                        asNavFor={variant}
                        className="ps-product__gallery ps-carousel inside">
                        {galleryImagesView}
                    </Slider>
                    <div className="ps-product__badge">
                        <span>
                            Save <br /> $280.00
                        </span>
                    </div>
                </div>
            </figure>
            {variantCarouselView}
        </div>
    );
};

export default ThumbnailWithBadge;
