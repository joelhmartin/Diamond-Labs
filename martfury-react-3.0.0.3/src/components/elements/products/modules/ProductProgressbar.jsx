import React from 'react';

const ProductProgressbar = ({ product }) => {
    return (
        <div
            className="ps-product__progress-bar ps-progress"
            data-value={product.inventory}>
            <div className="ps-progress__value">
                {(product.depot / product.inventory) * 100 < 100 ? (
                    <span
                        style={{
                            width:
                                (product.depot / product.inventory) * 100 + '%',
                        }}></span>
                ) : (
                    <span swtyle={{ width: '100%' }}></span>
                )}
            </div>

            <p>Sold: {Math.floor(Math.random() * 500) + 1}</p>
        </div>
    );
};

export default ProductProgressbar;
