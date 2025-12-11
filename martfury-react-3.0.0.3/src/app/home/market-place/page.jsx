'use client';
import React from 'react';
import MarketPlaceHomeBanner from '~/components/partials/homepage/marketplace/MartketPlaceHomeBanner';
import MarketPlaceSiteFeatures from '~/components/partials/homepage/marketplace/MarketPlaceSiteFeatures';
import MarketPlacePromotion from '~/components/partials/homepage/marketplace/MarketPlacePromotions';
import MarketPlaceDealOfDay from '~/components/partials/homepage/marketplace/MarketPlaceDealOfDay';
import Newsletters from '~/components/partials/commons/Newletters';
import PageContainer from '~/components/layouts/PageContainer';
import MarketPlacePromotionHeader from '~/components/partials/homepage/marketplace/MarketPlacePromotionHeader';
import HeaderMarketPlace from '~/components/shared/headers/HeaderMarketPlace';
import HeaderMobile from '~/components/shared/headers/HeaderMobile';
import MarketCollection from '~/components/partials/homepage/marketplace/modules/MarketCollection';
import {
    marketCollectionData,
    marketCollectionLinks,
} from '~/components/partials/homepage/marketplace/utils/marketCollectionData';

const HomeMarketPlacePage = () => {
    const headers = (
        <>
            <MarketPlacePromotionHeader />
            <HeaderMarketPlace />
            <HeaderMobile />
        </>
    );

    return (
        <PageContainer header={headers} title="Home Market Place">
            <main id="homepage-3">
                <MarketPlaceHomeBanner />
                <MarketPlaceSiteFeatures />
                <MarketPlacePromotion />
                <MarketPlaceDealOfDay collectionSlug="deals-of-the-day" />
                <div className="ps-section--gray">
                    <div className="container">
                        <MarketCollection
                            collectionSlug="clothings"
                            carouselImages={marketCollectionData.clothings}
                            links={marketCollectionLinks.clothings}
                            title={
                                <>
                                    Clothing & <br /> Apparel
                                </>
                            }
                        />
                        <MarketCollection
                            collectionSlug="consumer-electronics"
                            carouselImages={marketCollectionData.electronics}
                            links={marketCollectionLinks.electronics}
                            title={<>Consumer Electronics</>}
                        />
                        <MarketCollection
                            collectionSlug="customer-bought-products"
                            carouselImages={marketCollectionData.tehcnologies}
                            links={marketCollectionLinks.tehcnologies}
                            title={<>Computer & Techologies</>}
                        />
                        <MarketCollection
                            collectionSlug="garden-and-kitchen"
                            carouselImages={marketCollectionData.kitchen}
                            links={marketCollectionLinks.kitchen}
                            title={<>Garden & Kitchen</>}
                        />
                        <MarketCollection
                            collectionSlug="heathy-and-beauty"
                            carouselImages={marketCollectionData.healthy}
                            links={marketCollectionLinks.healthy}
                            title={
                                <>
                                    Health & <br /> Beauty
                                </>
                            }
                        />
                    </div>
                </div>
                <Newsletters />
            </main>
        </PageContainer>
    );
};
export default HomeMarketPlacePage;
