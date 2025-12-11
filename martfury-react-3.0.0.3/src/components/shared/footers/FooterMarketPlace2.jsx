import React from 'react';
import FooterWidgets from './modules/FooterWidgets';
import FooterLinks from './modules/FooterLinks';
import FooterCopyright from './modules/FooterCopyright';

const FooterMarketPlace2 = () => (
    <footer className="ps-footer ps-footer--3">
        <div className="container">
            <div className="ps-block--site-features ps-block--site-features-2">
                <div className="ps-block__item">
                    <div className="ps-block__left">
                        <i className="icon-rocket" />
                    </div>
                    <div className="ps-block__right">
                        <h4>Free Delivery</h4>
                        <p>For all oders over $99</p>
                    </div>
                </div>
                <div className="ps-block__item">
                    <div className="ps-block__left">
                        <i className="icon-sync" />
                    </div>
                    <div className="ps-block__right">
                        <h4>90 Days Return</h4>
                        <p>If goods have problems</p>
                    </div>
                </div>
                <div className="ps-block__item">
                    <div className="ps-block__left">
                        <i className="icon-credit-card" />
                    </div>
                    <div className="ps-block__right">
                        <h4>Secure Payment</h4>
                        <p>100% secure payment</p>
                    </div>
                </div>
                <div className="ps-block__item">
                    <div className="ps-block__left">
                        <i className="icon-bubbles" />
                    </div>
                    <div className="ps-block__right">
                        <h4>24/7 Support</h4>
                        <p>Dedicated support</p>
                    </div>
                </div>
            </div>
            <FooterWidgets />
            <FooterLinks />
            <FooterCopyright />
        </div>
    </footer>
);

export default FooterMarketPlace2;
