import React, { useMemo } from 'react';
import Link from 'next/link';
import { calculateAmount } from '~/utilities/ecomerce-helpers';

const ModuleCartSummary = ({ source }) => {
    // View

    const productContent = useMemo(() => {
        if (!source) return null;
        return source.map((item) => (
            <li key={item.id}>
                <span className="ps-block__estimate">
                    <Link
                        href={'/product/[pid]'}
                        as={`/product/${item.id}`}
                        className="ps-product__title">
                        {item.title}
                        <br />x{item.quantity}
                    </Link>
                </span>
            </li>
        ));
    }, [source]);

    return (
        <>
            <div className="ps-block--shopping-total">
                <div className="ps-block__header">
                    <p>
                        Subtotal{' '}
                        <span>${source ? calculateAmount(source) : 0}</span>
                    </p>
                </div>
                <div className="ps-block__content">
                    <ul className="ps-block__product">{productContent}</ul>
                    <h3>
                        Total{' '}
                        <span>${source ? calculateAmount(source) : 0}</span>
                    </h3>
                </div>
            </div>
        </>
    );
};

export default ModuleCartSummary;
