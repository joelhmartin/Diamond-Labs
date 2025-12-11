'use client';
import React from 'react';
import MartketPlace3Banner from '~/components/partials/homepage/marketplace3/MartketPlace3Banner';
import MarketPlace3SearchTrending from '~/components/partials/homepage/marketplace3/MarketPlace3SearchTrending';
import MarketPlace3Promotions from '~/components/partials/homepage/marketplace3/MarketPlace3Promotions';
import Market3ProductGroup from '~/components/partials/homepage/marketplace3/Market3ProductGroup';
import ModuleMarket3ProductGroupBanners from '~/components/partials/homepage/marketplace3/modules/ModuleMarket3ProductGroupBanners';
import HeaderMobile from '~/components/shared/headers/HeaderMobile';
import FooterMarketPlace2 from '~/components/shared/footers/FooterMarketPlace2';
import HeaderMarketPlace3 from '~/components/shared/headers/HeaderMarketPlace3';
import PageContainer from '~/components/layouts/PageContainer';
import HomeDefaultDealOfDay from '~/components/partials/homepage/home-default/HomeDefaultDealOfDay';

const HomeMarketPlace3Page = () => {
    const electricsLinks = [
        'TV Televisions',
        'Air Conditioner',
        'Washing Machine',
        'Refrigerator',
        'Microwave',
    ];

    const clothingsLinks = [
        'Women',
        'Men',
        'Girl',
        'Boy',
        'Baby',
        'Accessories',
    ];

    const headers = (
        <>
            <HeaderMarketPlace3 />
            <HeaderMobile />
        </>
    );
    const footer = <FooterMarketPlace2 />;
    return (
        <PageContainer
            header={headers}
            footer={footer}
            title="Home Marketplace 3">
            <main id="homepage-5">
                <div className="container">
                    <MartketPlace3Banner />
                    <MarketPlace3SearchTrending />
                    <HomeDefaultDealOfDay
                        collectionSlug="deals-of-the-day"
                        fullWidth={false}
                    />
                    <div className="ps-product-box">
                        <MarketPlace3Promotions />
                        <Market3ProductGroup
                            heading={{
                                icon: 'icon-laundry',
                                title: 'Consumer Electronic',
                            }}
                            categorySlug="consumer-electronics"
                            links={electricsLinks}
                            banners={
                                <ModuleMarket3ProductGroupBanners type="electronic" />
                            }
                        />
                        <Market3ProductGroup
                            heading={{
                                icon: 'icon-shirt',
                                title: 'Clothings & Apparel',
                            }}
                            categorySlug="clothings"
                            links={clothingsLinks}
                            banners={
                                <ModuleMarket3ProductGroupBanners type="clothing" />
                            }
                        />
                        <Market3ProductGroup
                            heading={{
                                icon: 'icon-home6',
                                title: 'Garden and Kitchen',
                            }}
                            categorySlug="garden-and-kitchen"
                            links={clothingsLinks}
                            banners={
                                <ModuleMarket3ProductGroupBanners type="garden" />
                            }
                        />
                    </div>
                </div>
            </main>
        </PageContainer>
    );
};

export default HomeMarketPlace3Page;
