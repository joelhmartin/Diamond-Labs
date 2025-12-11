'use client';
import React from 'react';
import Market2ProductGroupByCategory from '~/components/partials/homepage/marketplace2/Market2ProductGroupByCategory';
import MartketPlace2Banner from '~/components/partials/homepage/marketplace2/MartketPlace2Banner';
import MarketPlace2Promotions from '~/components/partials/homepage/marketplace2/MarketPlace2Promotions';
import MarketPlace2Download from '~/components/partials/homepage/marketplace2/MarketPlace2Download';
import MarketPlace2Categories from '~/components/partials/homepage/marketplace2/MarketPlace2Categories';
import HeaderMarketPlace2 from '~/components/shared/headers/HeaderMarketPlace2';
import HeaderMobile from '~/components/shared/headers/HeaderMobile';
import FooterMarketPlace2 from '~/components/shared/footers/FooterMarketPlace2';
import PageContainer from '~/components/layouts/PageContainer';

const HomeMarketPlace2Page = () => {
    const headers = (
        <>
            <HeaderMarketPlace2 />
            <HeaderMobile />
        </>
    );
    const footer = <FooterMarketPlace2 />;
    const productSections = [
        {
            slug: 'consumer-electronics',
            title: 'Consumer Electronics',
        },
        {
            slug: 'clothings',
            title: 'Clothings',
        },
        {
            slug: 'garden-and-kitchen',
            title: 'Garden & Kitchen',
        },
    ];

    return (
        <PageContainer
            header={headers}
            footer={footer}
            title="Home Marketplace 2">
            <main id="homepage-4">
                <MartketPlace2Banner />
                <MarketPlace2Categories />
                <MarketPlace2Promotions />
                {productSections.map((productSection) => (
                    <Market2ProductGroupByCategory
                        key={productSection.slug}
                        categorySlug={productSection.slug}
                        title={productSection.title}
                    />
                ))}
                <MarketPlace2Download />
            </main>
        </PageContainer>
    );
};

export default HomeMarketPlace2Page;
