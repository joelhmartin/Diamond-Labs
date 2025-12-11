import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getStrapiImageURL } from '~/services/strapiServices/image/getStrapiImageService';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import 'swiper/css/navigation';
import { Autoplay, Navigation, Pagination } from 'swiper/modules';
import LightGallery from 'lightgallery/react';

// import styles
import 'lightgallery/css/lightgallery.css';
import 'lightgallery/css/lg-zoom.css';
import 'lightgallery/css/lg-thumbnail.css';
import 'lightgallery/scss/lightgallery.scss';
import 'lightgallery/scss/lg-zoom.scss';
import lgThumbnail from 'lightgallery/plugins/thumbnail';
import lgZoom from 'lightgallery/plugins/zoom';

const ThumbnailDefault = ({ product, vertical = true }) => {
    const images = useMemo(() => {
        if (product.attributes.images.data?.length > 0) {
            return product.attributes.images.data.map((image) => {
                return {
                    url: getStrapiImageURL(image, 'large', true),
                };
            });
        } else {
            return [];
        }
    }, [product]);

    const [activeIndex, setActiveIndex] = useState(0);
    const primarySwiperRef = useRef(null);
    const secondarySwiperRef = useRef(null);

    const onPrimarySlideChange = (swiper) => {
        setActiveIndex(swiper.realIndex);
    };

    useEffect(() => {
        if (primarySwiperRef.current && primarySwiperRef.current.swiper) {
            primarySwiperRef.current.swiper.slideTo(activeIndex);
        }
        if (secondarySwiperRef.current && secondarySwiperRef.current.swiper) {
            secondarySwiperRef.current.swiper.slideTo(activeIndex);
        }
    }, [activeIndex]);

    function handlePrimaryPrev() {
        if (primarySwiperRef.current && primarySwiperRef.current.swiper) {
            primarySwiperRef.current.swiper.slidePrev();
        }
    }

    function handlePrimaryNext() {
        if (primarySwiperRef.current && primarySwiperRef.current.swiper) {
            primarySwiperRef.current.swiper.slideNext();
        }
    }

    return (
        <div
            className="ps-product__thumbnail"
            data-vertical={vertical ? 'true' : 'false'}>
            <figure>
                <div className="ps-wrapper carousel--productImages">
                    {images.length > 1 && (
                        <div className="swiper--custom-avigation">
                            <button onClick={handlePrimaryPrev}>
                                <i className="icon-chevron-left" />
                            </button>
                            <button onClick={handlePrimaryNext}>
                                <i className="icon-chevron-right" />
                            </button>
                        </div>
                    )}
                    <Swiper
                        ref={primarySwiperRef}
                        modules={[Autoplay, Pagination, Navigation]}
                        autoplay={{
                            delay: 5000,
                            disableOnInteraction: false,
                        }}
                        onSlideChange={(swiper) =>
                            setActiveIndex(swiper.activeIndex)
                        }>
                        {images.map((item, index) => (
                            <SwiperSlide className="item" key={index}>
                                <a href={'/'} className="carousel-image-link">
                                    <LightGallery
                                        speed={500}
                                        plugins={[lgThumbnail, lgZoom]}>
                                        <img src={item.url} alt={item.url} />
                                    </LightGallery>
                                </a>
                            </SwiperSlide>
                        ))}
                    </Swiper>
                </div>
            </figure>
            <div className="product__thumbnailImages">
                <Swiper
                    className="swiper-carousel--variants"
                    spaceBetween={12}
                    slidesPerView={4}
                    onSlideChange={onPrimarySlideChange}
                    slideToClickedSlide={true}
                    ref={secondarySwiperRef}
                    breakpoints={{
                        320: {
                            slidesPerView: 5,
                        },

                        1280: {
                            slidesPerView: 4,
                            direction: vertical ? 'vertical' : 'horizontal',
                        },
                    }}>
                    {images.map((item, index) => (
                        <SwiperSlide className="item" key={index}>
                            <img
                                src={item.url}
                                alt={item.url}
                                className={`swiper-slide-image ${
                                    index === activeIndex ? 'active' : ''
                                }`}
                                onClick={() => setActiveIndex(index)}
                            />
                        </SwiperSlide>
                    ))}
                </Swiper>
            </div>
        </div>
    );
};

export default ThumbnailDefault;
