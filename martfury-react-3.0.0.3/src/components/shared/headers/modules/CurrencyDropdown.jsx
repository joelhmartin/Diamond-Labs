import React from 'react';

export default function CurrencyDropdown() {
    const handleChangeCurrency = (e, currency) => {
        e.preventDefault();
        //this.props.dispatch(changeCurrency(currency));
    };
    return (
        <div className="ps-dropdown">
            USD
            <ul className="ps-dropdown-menu">
                <li>
                    <a href="/">USD</a>
                </li>
                <li>
                    <a href="/">EURO</a>
                </li>
                <li>
                    <a href="/">GBP</a>
                </li>
            </ul>
        </div>
    );
}
