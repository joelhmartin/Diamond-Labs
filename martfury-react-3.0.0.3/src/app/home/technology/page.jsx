'use client';
import React from 'react';
import ProductGroupDealOfDay from '~/components/partials/product/ProductGroupDealOfDay';
import TechnologyProductGroupWithCarousel from '~/components/partials/homepage/technology/TechnologyProductGroupWithCarousel';
import TechnologyBanner from '~/components/partials/homepage/technology/TechnologyBanner';
import TechnologySiteFeatures from '~/components/partials/homepage/technology/TechnologySiteFeatures';
import TechnologyPromotions from '~/components/partials/homepage/technology/TechnologyPromotions';
import TechnologyTopCategories from '~/components/partials/homepage/technology/TechnologyTopCategories';
import HeaderTechnology from '~/components/shared/headers/HeaderTechnology';
import HeaderMobileTechnology from '~/components/shared/headers/HeaderMobileTechnology';
import FooterSecond from '~/components/shared/footers/FooterSecond';
import PageContainer from '~/components/layouts/PageContainer';

const HomeTechnologyPage = () => {
    const smartPhoneLinks = ['Iphone, Ipad, Samsung'];
    const laptopAndSoundLinks = [
        'Apple',
        'Laptop',
        'Asus',
        'Mashall',
        'Speaker',
        'JBL',
        'Speaker',
    ];
    const toysLink = ['Micro', 'Drone/Flycam', 'JQOS'];
    const goodPriceLinks = [
        'Headphone',
        'Charge',
        'Case USB',
        'Hard Driver',
        'TV Box',
    ];
    const headers = (
        <>
            <HeaderTechnology />
            <HeaderMobileTechnology />
        </>
    );

    const footer = <FooterSecond classes="ps-footer--technology" />;

    return (
        <PageContainer
            header={headers}
            footer={footer}
            title="Homepage Technology">
            <main id="homepage-10">
                <TechnologyBanner />
                <TechnologySiteFeatures />
                <ProductGroupDealOfDay
                    collectionSlug="technology-deals"
                    boxed={true}
                />
                <TechnologyPromotions />
                <TechnologyTopCategories />
                <TechnologyProductGroupWithCarousel
                    collectionSlug="technology-smartphones"
                    title="Popular Smartphones & Tablets"
                    links={smartPhoneLinks}
                />
                <TechnologyProductGroupWithCarousel
                    collectionSlug="technology-best-seller"
                    title="Best Seller Laptops & Sounds"
                    links={laptopAndSoundLinks}
                />
                <TechnologyProductGroupWithCarousel
                    collectionSlug="technology-recommended"
                    title="Technology Toys Recommended For You"
                    links={toysLink}
                />
                <TechnologyProductGroupWithCarousel
                    collectionSlug="technology-accessories"
                    title="Good Price Accessories"
                    links={goodPriceLinks}
                />
            </main>
        </PageContainer>
    );
};

export default HomeTechnologyPage;
