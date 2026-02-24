Integrating with Seazona 
Requirements 
Endpoints 
You can find the base URL under: 
Settings ⇾ Advanced Settings ⇾ API Reference 
Authentication 
The Seazona API uses Basic HTTP authentication. Use your Seazona API Key as the username and API Secret as the password. You can find your API Key and API Secret under: Settings ⇾ Advanced Settings ⇾ API Reference 
The Authorization header is constructed as follows: 
● Username (API Key) and password (API Secret) are combined into a string "username:password" 
● The resulting string is then encoded using the RFC2045-MIME variant of Base64, except not limited to 76 char/line 
● The authorization method and a space i.e. "Basic " is then put before the encoded string. 
For example, if the API Key given is 'Seazona' and the API Secret is 'Rocks' then the header is formed as follows: 
● Authorization: Basic U2Vhem9uYTpSb2Nrcw== 
1 of 12
Clients 
Example Request 1 
Return all clients. 
GET v1/clients/?lastModified= 
Example Response 1 
[ 
{ 
"id": "e0367846-073f-4c46-9d22-28e41ef107f0", "accountNumber": "1000", 
"fullName": "Dr. John Doe", 
"company": "Affordable Podiatrist", 
"address1": "7650 S. McClintock Dr", 
"address2": "", 
"city": "Seattle", 
"region": "WA", 
"postalCode": "98125", 
"countryCode": "US", 
"phone1": "4804352747", 
"phone2": "", 
"email": "john@doe.com" 
}, 
{ 
"id": "e1df9919-ca84-4bf2-8480-f61c9cde4ea1", "accountNumber": "1004", 
"fullName": "", 
"company": "Arizona Podiatry", 
"address1": "7650 S. McClintock Dr", 
"address2": "Suite 103-396", 
"city": "Tempe", 
"region": "AZ", 
"postalCode": "85284", 
"countryCode": "US", 
"phone1": "4802748514", 
"phone2": "", 
"email": "info@azpodiatry.com" 
}, 
] 
2 of 12
Example Request 2 
Return all clients based on the last modified date. 
GET v1/clients/?lastModified={lastModified} 
lastModified is a DateTime type, expressed as a normalized UTC value in the format: yyyy-mm-ddThh:mm[:ss[.fff]]Z. 
For example, the date 30 Dec 2001 9:30:00 AM UTC is formatted as 2001-12-30T09:30:00Z. 
Example Response 2 
[ 
{ 
"id": "e0367846-073f-4c46-9d22-28e41ef107f0", 
"accountNumber": "1000", 
"fullName": "Dr. John Doe", 
"company": "Affordable Podiatrist", 
"address1": "7650 S. McClintock Dr", 
"address2": "", 
"city": "Seattle", 
"region": "WA", 
"postalCode": "98125", 
"countryCode": "US", 
"phone1": "4804352747", 
"phone2": "", 
"email": "john@doe.com" 
}, 
{ 
"id": "e1df9919-ca84-4bf2-8480-f61c9cde4ea1", 
"accountNumber": "1004", 
"fullName": "", 
"company": "Arizona Podiatry", 
"address1": "7650 S. McClintock Dr", 
"address2": "Suite 103-396", 
"city": "Tempe", 
"region": "AZ", 
"postalCode": "85284", 
"countryCode": "US", 
"phone1": "4802748514", 
"phone2": "", 
"email": "info@azpodiatry.com" 
} 
] 
3 of 12
Example Request 3 
Return a specific client. 
GET v1/clients/{id} 
Example Response 3 
{ 
"id": "e0367846-073f-4c46-9d22-28e41ef107f0", "accountNumber": "1000", 
"fullName": "Dr. John Doe", 
"company": "Affordable Podiatrist", 
"address1": "7650 S. McClintock Dr", 
"address2": "", 
"city": "Seattle", 
"region": "WA", 
"postalCode": "98125", 
"countryCode": "US", 
"phone1": "4804352747", 
"phone2": "", 
"emailAddresses": "john@doe.com", 
"idNumber": "", 
"deliveryNotes": "", 
"preferences": "", 
"taxRate": 0.0875, 
"discontinued": false, 
"doctors": [], 
"lastModified": "2021-01-11T22:41:22" 
} 
Example Request 4 
Return a boolean (true/false) as to whether a client login exists. GET v1/clients/login-exists?email={email} 
Example Response 4 
“true” 
4 of 12
Invoices 
Example Request 1 
Return all invoices based on the last modified date. 
GET v1/invoices/?lastModified={lastModified} 
lastModified is a DateTime type, expressed as a normalized UTC value in the format: yyyy-mm-ddThh:mm[:ss[.fff]]Z. 
For example, the date 30 Dec 2001 9:30:00 AM UTC is formatted as 2001-12-30T09:30:00Z. 
Example Response 1 
[ 
{ 
"id": "8884fa19-4db4-460e-a4c1-a9487a9b6ab7", 
"invoiceNumber": 1008, 
"patient": "Patient 0021", 
"clientId": "e0367846-073f-4c46-9d22-28e41ef107f0", 
"fullName": "Dr. John Doe", 
"company": "Affordable Podiatrist", 
"sales": 114, 
"tax": 9.98, 
"discounts": 0, 
"total": 123.98, 
"status": "Shipped", 
"due": "2021-01-11T00:00:00", 
"lastModified": "2021-01-11T22:41:22" 
}, 
{ 
"id": "769b79e9-3924-4cdc-b460-137615d904d9", 
"invoiceNumber": 1001, 
"patient": "Patient 42342342", 
"clientId": "746ac46b-8c0e-48b9-b406-ab89c05841ad", 
"fullName": "", 
"company": "East Orthotic Center", 
"sales": 1, 
"tax": 0, 
"discounts": 0, 
"total": 1, 
"status": "Shipped", 
"due": "2021-01-11T00:00:00", 
5 of 12
"lastModified": "2021-01-11T22:41:22" 
} 
] 
Example Request 2 
Return a specific invoice. 
GET v1/invoices/{id} 
Example Response 2 
{ 
"id": "10e74489-c292-4182-8264-44512a7b80a6", "invoiceNumber": 1108, 
"patient": "Patient 34239", 
"clientId": "e0367846-073f-4c46-9d22-28e41ef107f0", "fullName": "Dr. John Doe", 
"company": "Affordable Podiatrist", 
"productServiceItems": [ 
{ 
"id": "3fa0ad6a-ec65-41f1-b0a4-8a116d89467f", "type": "product", 
"name": "Milled Eva Firm Blue", 
"taxable": true, 
"price": 5 
} 
], 
"discountItems": [], 
"sales": 5, 
"tax": 0.44, 
"discounts": 0, 
"subtotal": 5, 
"total": 5.44, 
"status": "In Production", 
"due": "2022-03-10T00:00:00", 
"lastModified": "2022-03-13T03:53:44" 
} 
6 of 12
Orders 
Example POST Request 
Create an order for a given client. 
items arch can be 1 (upper), 2 (lower), or null 
items id is the product ID 
POST v1/orders/ 
{ 
"clientId":"e0367846-073f-4c46-9d22-28e41ef107f0", 
"patientName":"Jane Doe", 
"due":"2024-04-18T10:35:45", 
"items": [ 
{ 
"id":"b28070e1-2ad0-4708-a0d6-b93b28cfdb6c", 
"arch":1 
} 
], 
"notes": "My lab notes", 
"userId": "8cf93fe5-a167-4d97-922b-f951493dfe30" 
} 
Example POST Response 
{ 
"orderId": "0de4ca73-6565-4cff-96f4-bb867621662c" 
} 
Example Request 1 
Return all orders based on the order date. 
GET v1/orders/?ordered={ordered} 
ordered is a DateTime type, in the format: yyyy-mm-ddThh:mm[:ss[.fff]]Z. For example, the date 30 Dec 2001 9:30:00 AM is formatted as 2001-12-30T09:30:00Z. 
Example Response 1 
[ 
7 of 12
{ 
"id": "ce8b1bc5-65da-4820-903c-0ec7c9535fe4", "invoiceNumber": 1116, 
"patient": "Patient 161616", 
"clientId": "b8fed37b-475b-464a-9a5b-106cbcefc86c", "clientName": "Dr. James Smith", 
"company": "Dr. James Smith", 
"status": "In Prod", 
"department": "MILLING", 
"assignedTo": "Ron De Rose", 
"fileExists": true, 
"ordered": "2021-07-02T10:35:45", 
"due": "2022-03-10T00:00:00" 
}, 
{ 
"id": "4b650060-be1c-4f0e-929d-275e4830f558", "invoiceNumber": 1112, 
"patient": "Patient 44446", 
"clientId": "e0367846-073f-4c46-9d22-28e41ef107f0", "clientName": "Dr. John Doe", 
"company": "Affordable Podiatrist", 
"status": "In Prod", 
"department": "MILLING", 
"assignedTo": "Ron De Rose", 
"fileExists": true, 
"ordered": "2021-07-02T07:56:59", 
"due": "2022-03-10T00:00:00" 
} 
] 
Example Request 2 
Return a specific order. 
GET v1/orders/{id} 
Example Response 2 
{ 
"id": "9ba2af8a-5766-4c73-8741-f14b41eed2d7", "invoiceNumber": 1124, 
"patient": "Patient 23324", 
"clientId": "746ac46b-8c0e-48b9-b406-ab89c05841ad", "clientName": "Dr. Ben A. Gibbs", 
8 of 12
"company": "East Orthotic Center", 
"status": "In Prod", 
"department": "ETHOTICS", 
"assignedTo": "Allison Oliveros", 
"ordered": "2021-07-02T10:50:54", 
"due": "2022-03-10T00:00:00", 
"notes": "Please fabricate 18-20 zirconia bridge", 
"products": [ 
{ 
"id": "2b69c5ae-c3f3-4dd4-b58e-a9313e0051b7", "code": "1046", 
"name": "FULL ZIRCONIA CROWN" 
} 
], 
"files": [ 
{ 
"name": "fa26e327-9f3c-4c67-a6db-c4b07fbae7d6.stl", "originalName": "Right.stl", 
"url": "https://…/fa26e327-9f3c-4c67-a6db-c4b07fbae7d6.stl", "extension": ".stl", 
"size": 1207784 
} 
], 
"settings":[ 
{"name":"Color","value":"Black"}, 
{"name":"Gender","value":"Male"} 
] 
} 
9 of 12
Payments 
Example POST Request 
Create a payment for a given client. 
POST v1/payments/ 
{ 
"clientId": "", 
"accountNumber": "1000", 
"referenceNumber": "987654321", 
"notes": "Statement June 2023", 
"amount": 100.00 
} 
Example POST Response 
{ 
"paymentId": "0de4ca73-6565-4cff-96f4-bb867621662c", "clientId": "e0367846-073f-4c46-9d22-28e41ef107f0" } 
Example GET Request 
Return a specific payment. 
GET v1/payments/{id} 
Example GET Response 
{ 
"clientId": "e0367846-073f-4c46-9d22-28e41ef107f0", "accountNumber": "1000", 
"referenceNumber": "123456789", 
"notes": "Invoice 1234", 
"amount": 100.00 
} 
10 of 12
Products 
Example Request 1 
Return all products. 
GET v1/products/ 
Example Response 1 
[ 
{ 
"id": "65c6248f-601d-4412-bed6-6a3b63cbce01", "code": "1234", 
"name": "3/4 Length Sport", 
"taxable": true, 
"price": 1 
}, 
{ 
"id": "ff2ae873-3297-4674-8b09-bb210dd7509d", "code": "5678", 
"name": "3/4 Pro-X", 
"taxable": true, 
"price": 1 
} 
] 
Example Request 2 
Return a specific product. 
GET v1/products/{id} 
Example Response 2 
{ 
"id": "8a960ad2-0f30-4414-8f5c-e0844aaa026a", "code": "9988", 
"name": "UCBL Special Order", 
"taxable": true, 
"price": 1 
} 
11 of 12
Users 
Example Request 1 
Return all users. 
GET v1/users/ 
Example Response 1 
[ 
{ 
"id": "f3351315-952b-4b47-bc7c-370ed6ce218f", "firstName": "Allison", 
"lastName": "Oliveros", 
"email": "allison@seazona.com" 
}, 
{ 
"id": "8cf93fe5-a167-4d97-922b-f951493dfe30", "firstName": "John", 
"lastName": "Smith", 
"email": "john@seazona.com" 
} 
] 
Example Request 2 
Return a specific user. 
GET v1/users/{id} 
Example Response 2 
{ 
"id": "5ab635ec-9c56-446c-8f16-86e4cb34f310", "firstName": "Thomas", 
"lastName": "Aronica", 
"email": "taronica@billergenie.com" 
} 
12 of 12

