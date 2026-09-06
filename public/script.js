document.addEventListener('DOMContentLoaded', () => {
  const payButton = document.getElementById('pay-button');

  if (!payButton) return;

  payButton.addEventListener('click', async (event) => {
    event.preventDefault();

    // 1. Immediately disable button & change text to prevent double clicks
    payButton.disabled = true;
    const originalText = payButton.innerText;
    payButton.innerText = 'Processing Order...';

    // Generate or fetch order payload
    const orderData = {
      items: [/* item list */],
      amount: 100,
      timestamp: Date.now()
    };

    try {
      // 2. Send request to your Node.js backend
      const response = await fetch('/api/place-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(orderData)
      });

      const data = await response.json();

      if (response.ok) {
        alert('Order placed successfully!');
        // Redirect to success page or clear shopping cart
        // window.location.href = '/success.html';
      } else {
        alert(`Order failed: ${data.message || 'Please try again.'}`);
        // Re-enable button if order failed so user can retry
        payButton.disabled = false;
        payButton.innerText = originalText;
      }
    } catch (error) {
      console.error('Error placing order:', error);
      alert('Network error. Please check your connection and try again.');
      // Re-enable button on error
      payButton.disabled = false;
      payButton.innerText = originalText;
    }
  });
});
